#!/usr/bin/env bun
/**
 * Generate fish and bash shell completion scripts from completions/bun-cli.json.
 *
 * The JSON is produced by misctools/generate-cli-completions.ts (which parses
 * `bun <cmd> --help`). This script turns that data into the static flag lists
 * that each shell's completion script needs, while leaving the hand-written
 * dynamic bits (package.json script discovery, `bun getcompletes` calls,
 * package-name history) intact.
 *
 * Regenerate after updating bun-cli.json:
 *   bun run misctools/generate-shell-completions.ts
 *
 * zsh is not generated here yet because its existing completion file carries a
 * lot of custom state-machine logic; fish and bash are the ones that had drifted.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

interface FlagInfo {
  name: string;
  shortName?: string;
  description: string;
  hasValue: boolean;
  valueType?: string;
  required?: boolean;
  multiple?: boolean;
}

interface SubcommandInfo {
  name: string;
  description: string;
  flags?: FlagInfo[];
  subcommands?: Record<string, SubcommandInfo>;
}

interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  flags: FlagInfo[];
  subcommands?: Record<string, SubcommandInfo>;
}

interface CompletionData {
  version: string;
  commands: Record<string, CommandInfo>;
  globalFlags: FlagInfo[];
}

const root = join(import.meta.dir, "..");
const data: CompletionData = JSON.parse(readFileSync(join(root, "completions", "bun-cli.json"), "utf8"));

// Some descriptions in the JSON are parsing artefacts (section headers, version banners).
// Fall back to short descriptions for those so the completion UI stays readable.
const commandDescriptionOverrides: Record<string, string> = {
  run: "Run a file or package.json script with Bun",
  repl: "Start a REPL session with Bun",
  exec: "Execute a shell script with Bun Shell",
  outdated: "Display latest versions of outdated dependencies",
  publish: "Publish a package to the npm registry",
  create: "Create a new project from a template",
  upgrade: "Upgrade Bun to the latest version",
};

function commandDescription(cmd: CommandInfo): string {
  const override = commandDescriptionOverrides[cmd.name];
  if (override) return override;
  const d = (cmd.description || "").trim();
  // Reject obvious parse failures: section headers, version strings, empty.
  if (!d || /^(Flags|Options):$/.test(d) || /\bv\d+\.\d+\.\d+/.test(d)) {
    return cmd.name;
  }
  return d;
}

// Commands that use the runtime's shared flag set (everything `bun`/`bun run`/`bun test`
// accept). These are the ones the original issue called out for --watch / --hot.
const runtimeCommands = new Set(["run", "test", "repl", "exec"]);

// Flags that the --help parser misses (commands whose help text is non-standard).
const extraFlags: Record<string, FlagInfo[]> = {
  upgrade: [
    { name: "canary", description: "Install the latest canary build", hasValue: false },
    { name: "stable", description: "Install the latest stable build", hasValue: false },
  ],
};

function flagsFor(cmd: CommandInfo): FlagInfo[] {
  return [...cmd.flags, ...(extraFlags[cmd.name] ?? [])];
}

function isShortOnly(flag: FlagInfo): boolean {
  return flag.name.length === 1;
}

// Global flags whose value is a separate word; the subcommand scan (both
// shells) must step over that value so `bun --cwd dir <TAB>` doesn't treat
// `dir` as the subcommand. These four are declared `<X>?` in Arguments.rs
// (value optional, only binds via `=`), so exclude them here.
const optionalValueGlobals = new Set(["inspect", "inspect-wait", "inspect-brk", "config"]);
const globalValueFlags: string[] = data.globalFlags
  .filter(f => f.hasValue && !isShortOnly(f) && !optionalValueGlobals.has(f.name))
  .flatMap(f => [`--${f.name}`, ...(f.shortName ? [`-${f.shortName}`] : [])])
  .sort();

// Commands that only list their own flags from the JSON.
function commandsWithOwnFlags(): CommandInfo[] {
  return Object.values(data.commands).filter(c => flagsFor(c).length > 0 || runtimeCommands.has(c.name));
}

/* -------------------------------------------------------------------------- */
/*                                    fish                                    */
/* -------------------------------------------------------------------------- */

function fishEscape(s: string): string {
  // Single-quote for fish; escape embedded single quotes and backslashes.
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function fishFlag(condition: string, flag: FlagInfo): string {
  const parts = ["complete -c bun", `-n '${condition}'`];
  if (isShortOnly(flag)) {
    parts.push(`-s '${flag.shortName ?? flag.name}'`);
  } else {
    if (flag.shortName) parts.push(`-s '${flag.shortName}'`);
    parts.push(`-l '${flag.name}'`);
  }
  if (flag.hasValue && !optionalValueGlobals.has(flag.name)) {
    parts.push("-r");
  } else {
    parts.push("-f");
  }
  const desc = (flag.description || "").trim();
  if (desc) parts.push(`-d '${fishEscape(desc)}'`);
  return parts.join(" ");
}

function generateFish(): string {
  const aliasMap: Record<string, string[]> = {};
  for (const c of Object.values(data.commands)) {
    aliasMap[c.name] = [c.name, ...(c.aliases?.filter(a => a !== "bunx") ?? [])];
  }
  const allSubTokens = Object.values(aliasMap).flat().join(" ");

  const pmSubcommands = Object.values(data.commands.pm?.subcommands ?? {});
  const pmSubNames = pmSubcommands.map(s => s.name).join(" ");

  const lines: string[] = [];
  lines.push(`# Auto-generated by misctools/generate-shell-completions.ts from completions/bun-cli.json.
# Do not edit by hand; edit the generator or regenerate the JSON instead.

function __fish__get_bun_bins
    string split ' ' (bun getcompletes b)
end

function __fish__get_bun_scripts
    set -lx SHELL bash
    set -lx MAX_DESCRIPTION_LEN 40
    string trim (string split '\\n' (string split '\\t' (bun getcompletes z)))
end

function __fish__get_bun_packages
    if test (commandline -ct) != ""
        set -lx SHELL fish
        string split ' ' (bun getcompletes a (commandline -ct))
    end
end

function __history_completions
    set -l tokens (commandline --current-process --tokenize)
    history --prefix (commandline) | string replace -r \\^\$tokens[1]\\\\s\\* "" | string replace -r \\^\$tokens[2]\\\\s\\* "" | string split ' '
end

function __fish__get_bun_bun_js_files
    string split ' ' (bun getcompletes j)
end

function __bun_first_arg_in -d "Test whether the first non-option token is one of the given words"
    set -l tokens (commandline -poc)
    set -e tokens[1]
    set -l skip 0
    for t in \$tokens
        if test \$skip -eq 1
            set skip 0
            continue
        end
        switch \$t
            case ${globalValueFlags.join(" ")}
                set skip 1
            case '-*'
                continue
            case \$argv
                return 0
            case '*'
                return 1
        end
    end
    return 1
end

set -l bun_builtin_cmds_without_run ${Object.values(aliasMap)
    .filter(a => a[0] !== "run")
    .flat()
    .join(" ")}

function __bun_complete_bins_scripts --inherit-variable bun_builtin_cmds_without_run -d "Emit bun completions for bins and scripts"
    if __fish_seen_subcommand_from \$bun_builtin_cmds_without_run
    or not __fish_use_subcommand && not __fish_seen_subcommand_from run
        return
    end
    set -l bins (__fish__get_bun_bins)
    if __fish_seen_subcommand_from \$bins
        return
    end
    set -l scripts (__fish__get_bun_scripts)
    if __fish_seen_subcommand_from (string split \\t -f 1 -- \$scripts)
        return
    end
    for script in \$scripts
        echo \$script
    end
    if __fish_seen_subcommand_from run
        for bin in \$bins
            echo "\$bin"\\t"package bin"
        end
        for file in (__fish__get_bun_bun_js_files)
            echo "\$file"\\t"Bun.js"
        end
    end
end

complete -e -c bun
complete -c bun -f -a "(__bun_complete_bins_scripts)"

complete -c bun -s 'h' -l 'help' -f -d 'Show command help'
complete -c bun -n "not __bun_first_arg_in ${allSubTokens}" -s 'v' -l 'version' -f -d 'Print version and exit'
`);

  // Subcommand list (first-positional).
  lines.push("# Subcommands");
  for (const cmd of Object.values(data.commands)) {
    const desc = fishEscape(commandDescription(cmd));
    lines.push(`complete -c bun -n "__fish_use_subcommand" -a '${cmd.name}' -f -d '${desc}'`);
  }
  lines.push("");

  // Global runtime flags: offered when no subcommand yet, or under run/test/repl/exec.
  // The subcommand token list is inlined (not a `set -l` variable) because
  // `complete -n` stores the condition string and evaluates it at tab-press
  // time, after script-local variables have gone out of scope.
  lines.push("# Global runtime flags (bun / bun run / bun test / bun repl / bun exec)");
  const runtimeCond =
    `not __bun_first_arg_in ${allSubTokens}; ` + `or __bun_first_arg_in ${[...runtimeCommands].join(" ")}`;
  for (const flag of data.globalFlags) {
    if (flag.name === "help" || flag.name === "version") continue;
    lines.push(fishFlag(runtimeCond, flag));
  }
  lines.push("");

  // Per-command flags.
  for (const cmd of commandsWithOwnFlags()) {
    const flags = flagsFor(cmd);
    if (flags.length === 0) continue;
    const names = aliasMap[cmd.name].join(" ");
    lines.push(`# bun ${cmd.name}`);
    const cond = `__bun_first_arg_in ${names}`;
    for (const flag of flags) {
      if (flag.name === "help") continue;
      lines.push(fishFlag(cond, flag));
    }
    lines.push("");
  }

  // pm subcommands.
  if (pmSubcommands.length) {
    lines.push("# bun pm subcommands");
    lines.push(
      `complete -c bun -n "__fish_seen_subcommand_from pm; and not __fish_seen_subcommand_from ${pmSubNames}" -f -a '${pmSubNames}'`,
    );
    for (const sub of pmSubcommands) {
      if (sub.subcommands) {
        const nested = Object.keys(sub.subcommands).join(" ");
        lines.push(
          `complete -c bun -n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from ${sub.name}; and not __fish_seen_subcommand_from ${nested}" -f -a '${nested}'`,
        );
      }
    }
    lines.push("");
  }

  // Dynamic package-name completion for add/remove.
  lines.push("# Dynamic package-name completion");
  lines.push(`complete -c bun -n "__bun_first_arg_in add a" -f -d 'Popular' -a '(__fish__get_bun_packages)'`);
  lines.push(`complete -c bun -n "__bun_first_arg_in add a" -f -d 'History' -a '(__history_completions)'`);
  lines.push(
    `complete -c bun -n "__bun_first_arg_in create c; and not __fish_seen_subcommand_from next react" -f -a 'next react'`,
  );
  lines.push("");

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/*                                    bash                                    */
/* -------------------------------------------------------------------------- */

function bashFlagList(flags: FlagInfo[]): string {
  const words = new Set<string>();
  for (const f of flags) {
    if (isShortOnly(f)) {
      words.add(`-${f.shortName ?? f.name}`);
    } else {
      words.add(`--${f.name}`);
      if (f.shortName) words.add(`-${f.shortName}`);
    }
  }
  return [...words].sort().join(" ");
}

function generateBash(): string {
  const allCommandNames = Object.values(data.commands)
    .flatMap(c => [c.name, ...(c.aliases?.filter(a => a !== "bunx") ?? [])])
    .sort();

  const globalOptions = bashFlagList(data.globalFlags);

  const perCommand: Record<string, { options: string; aliases: string[] }> = {};
  for (const cmd of Object.values(data.commands)) {
    const aliases = [cmd.name, ...(cmd.aliases?.filter(a => a !== "bunx") ?? [])];
    const cmdFlags = flagsFor(cmd);
    const options = cmdFlags.length > 0 || !runtimeCommands.has(cmd.name) ? bashFlagList(cmdFlags) : "";
    perCommand[cmd.name] = { options, aliases };
  }

  const pmSubcommands = Object.keys(data.commands.pm?.subcommands ?? {})
    .sort()
    .join(" ");

  // Build the case arms for per-command flag completion.
  const caseArms: string[] = [];
  for (const cmd of Object.values(data.commands)) {
    const entry = perCommand[cmd.name];
    const pattern = entry.aliases.join("|");
    const varName = `BUN_${cmd.name.toUpperCase()}_OPTIONS`;
    if (cmd.name === "run") {
      caseArms.push(
        `        ${pattern})
            _file_arguments "!(*.@(js|ts|jsx|tsx|mjs|cjs|mts|cts|html)?(\$|))";
            _flag_completion "\${GLOBAL_OPTIONS}";
            _read_scripts_in_package_json;
            return;;`,
      );
    } else if (cmd.name === "test") {
      caseArms.push(
        `        ${pattern})
            _file_arguments "!(*@(_|.)@(test|spec).@(js|ts|jsx|tsx|mjs|cjs|mts|cts)?(\$|))";
            _flag_completion "\${${varName}} \${GLOBAL_OPTIONS}";
            return;;`,
      );
    } else if (cmd.name === "pm") {
      const flagLine = entry.options ? `\n            _flag_completion "\${${varName}}";` : "";
      caseArms.push(
        `        ${pattern})${flagLine}
            COMPREPLY+=( \$(compgen -W "${pmSubcommands}" -- "\${cur_word}") );
            return;;`,
      );
    } else if (runtimeCommands.has(cmd.name)) {
      caseArms.push(
        `        ${pattern})
            _flag_completion "\${GLOBAL_OPTIONS}";
            return;;`,
      );
    } else if (cmd.name === "build") {
      caseArms.push(
        `        ${pattern})
            _file_arguments "!(*.@(js|ts|jsx|tsx|mjs|cjs|mts|cts|css|html)?(\$|))";
            _flag_completion "\${${varName}}";
            return;;`,
      );
    } else if (entry.options) {
      caseArms.push(
        `        ${pattern})
            _flag_completion "\${${varName}}";
            return;;`,
      );
    } else {
      caseArms.push(
        `        ${pattern})
            return;;`,
      );
    }
  }

  // Option variable declarations.
  const optionVars: string[] = [];
  optionVars.push(`    local GLOBAL_OPTIONS="${globalOptions}";`);
  for (const cmd of Object.values(data.commands)) {
    const entry = perCommand[cmd.name];
    if (!entry.options) continue;
    optionVars.push(`    local BUN_${cmd.name.toUpperCase()}_OPTIONS="${entry.options}";`);
  }

  const flagsWithDirValue = ["--cwd", "--coverage-dir", "--outdir", "--public-dir", "--cache-dir", "--root"];

  return `#/usr/bin/env bash
# Auto-generated by misctools/generate-shell-completions.ts from completions/bun-cli.json.
# Do not edit by hand; edit the generator or regenerate the JSON instead.

_file_arguments() {
    local extensions="\${1}"
    local reset
    reset="\$(shopt -p extglob 2>/dev/null)"
    shopt -s extglob 2>/dev/null
    COMPREPLY+=( \$(compgen -f -X "\${extensions}" -- "\${cur_word}") )
    eval "\$reset" 2>/dev/null
}

_flag_completion() {
    [[ -z "\${cur_word}" || "\${cur_word}" == -* ]] && \\
        COMPREPLY+=( \$(compgen -W "\${1}" -- "\${cur_word}") );
}

_read_scripts_in_package_json() {
    local working_dir="\${PWD}";
    local line=0;
    for ((; line < \${#COMP_WORDS[@]}; line+=1)); do
        [[ "\${COMP_WORDS[\${line}]}" == "--cwd" ]] && working_dir="\${COMP_WORDS[\$((line + 1))]}";
    done
    local scripts
    scripts=\$(cd "\${working_dir}" 2>/dev/null && SHELL=bash bun getcompletes s 2>/dev/null)
    COMPREPLY+=( \$(compgen -W "\${scripts}" -- "\${cur_word}") )
}

_bun_completions() {
    local SUBCOMMANDS="${allCommandNames.join(" ")}";

${optionVars.join("\n")}

    local cur_word="\${COMP_WORDS[\${COMP_CWORD}]}";
    local prev="\${COMP_WORDS[\$(( COMP_CWORD - 1 ))]}";

    case "\${prev}" in
        help|--help|-h|-v|--version) return;;
        -c|--config) _file_arguments "!*.toml" && return;;
        --backend)
            COMPREPLY=( \$(compgen -W "clonefile copyfile hardlink clonefile_each_dir symlink" -- "\${cur_word}") );
            return;;
        ${flagsWithDirValue.join("|")})
            COMPREPLY=( \$(compgen -d -- "\${cur_word}" ));
            return;;
        --jsx-runtime)
            COMPREPLY=( \$(compgen -W "automatic classic" -- "\${cur_word}") );
            return;;
        --target)
            COMPREPLY=( \$(compgen -W "browser node bun" -- "\${cur_word}") );
            return;;
        --unhandled-rejections)
            COMPREPLY=( \$(compgen -W "strict throw warn none warn-with-error-code" -- "\${cur_word}") );
            return;;
        --install)
            COMPREPLY=( \$(compgen -W "auto fallback force" -- "\${cur_word}") );
            return;;
        -l|--loader)
            [[ "\${cur_word}" =~ (:) ]] && {
                local cut_colon_forward="\${cur_word%%:*}"
                COMPREPLY=( \$(compgen -W "\${cut_colon_forward}:jsx \${cut_colon_forward}:js \${cut_colon_forward}:json \${cut_colon_forward}:tsx \${cut_colon_forward}:ts \${cut_colon_forward}:css" -- "\${cut_colon_forward}:\${cur_word##*:}") );
            }
            return;;
    esac

    local first_word="" i
    for (( i=1; i < COMP_CWORD; i++ )); do
        case "\${COMP_WORDS[i]}" in
            =) ((i++)) ;;
            ${globalValueFlags.join("|")}) ((i++)); [[ "\${COMP_WORDS[i]}" == "=" ]] && ((i++)) ;;
            -*) ;;
            *) first_word="\${COMP_WORDS[i]}"; break ;;
        esac
    done

    case "\${first_word}" in
        help|completions) return;;
${caseArms.join("\n")}
        "")
            _flag_completion "\${GLOBAL_OPTIONS}";
            COMPREPLY+=( \$(compgen -W "\${SUBCOMMANDS}" -- "\${cur_word}") );
            _read_scripts_in_package_json;
            _file_arguments "!(*.@(js|ts|jsx|tsx|mjs|cjs|mts|cts|html)?(\$|))";
            return;;
        *)
            COMPREPLY+=( \$(compgen -f -- "\${cur_word}") );
            return;;
    esac
}

complete -F _bun_completions bun
`;
}

/* -------------------------------------------------------------------------- */

const fishOut = generateFish();
const bashOut = generateBash();

if (process.argv.includes("--check")) {
  const onDiskFish = readFileSync(join(root, "completions", "bun.fish"), "utf8");
  const onDiskBash = readFileSync(join(root, "completions", "bun.bash"), "utf8");
  let failed = false;
  if (onDiskFish !== fishOut) {
    console.error("completions/bun.fish is stale; run: bun run misctools/generate-shell-completions.ts");
    failed = true;
  }
  if (onDiskBash !== bashOut) {
    console.error("completions/bun.bash is stale; run: bun run misctools/generate-shell-completions.ts");
    failed = true;
  }
  process.exit(failed ? 1 : 0);
}

writeFileSync(join(root, "completions", "bun.fish"), fishOut);
writeFileSync(join(root, "completions", "bun.bash"), bashOut);
console.log("wrote completions/bun.fish");
console.log("wrote completions/bun.bash");
