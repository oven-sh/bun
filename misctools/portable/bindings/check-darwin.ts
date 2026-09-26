// Checks the bindings of macOS of the portable image against the rules that a call from the image into
// macOS has to keep, and against everything that can say what macOS is without a Mac.
//
//   bun check-darwin.ts [--xnu <checkout of apple-oss-distributions/xnu>] [--fixture <file.rs>]
//
// Exits with 1 if a rule is broken. The rules, for every function that an `extern` block binds with
// `bun_portable_macros::imports(library = "libSystem", ..)`:
//
//   R1  The block says `host = "macos"`: without it the function would be called with the calling
//       convention of Windows.
//   R2  The function is not declared with `...`, and the symbol it binds is no function of macOS that
//       takes a variable number of arguments (open, openat, fcntl, ioctl, syscall, the printf family,
//       and their $NOCANCEL forms): on arm64 macOS reads such arguments from the stack, where the image
//       does not put them. The image binds a function of the host with fixed arguments in its place,
//       `bun_host_darwin_<name><number of arguments>`.
//   R3  A function of the host that is bound exists in the host (host/host_posix.c), and takes the
//       number of arguments that its name ends with.
//   R4  At most 8 arguments are integers or pointers, and at most 8 are floating point numbers: the
//       ninth is on the stack, which macOS packs and the image does not.
//   R5  An argument is an integer of at least 32 bits, a floating point number, a pointer, a reference
//       or a function, or an integer of fewer bits, which `#[imports]` passes as 32 (they are listed).
//       Anything else, a structure by value for one, is refused: `#[imports]` has no rule for it.
//   R6  A function of the image that macOS calls (an argument that is a function) takes and returns
//       integers of at least 32 bits, floating point numbers and pointers, at most 8 of each kind, and
//       no variable number of arguments: macOS expects a short result extended to 32 bits, which a
//       function of the image does not do, and passes what does not fit into registers packed.
//
// `#[imports]` refuses R2, R4, R5 and R6 itself when the image is compiled (bun_darwin_sys::abi). This tool
// reads the sources, so it also sees a block under a `cfg` that was not compiled, and it knows the
// functions of macOS by name.
//
// And, for the definitions:
//
//   D1  src/darwin_sys/generated.rs, darwin_layout.c and the layout program of the image are what
//       darwin.ts writes from the libc crate today.
//   D2  The error numbers that macOS has and Linux has not become the same error of the image in
//       bun_darwin_sys (darwin-errno.json) and in the host (host/host_posix.c).
//   D3  With --xnu: every constant of the bindings that a header of xnu defines with a number has that
//       number there. (xnu is the kernel of macOS; its headers under bsd/sys are the ones that the SDK
//       ships. A second source next to the libc crate.)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tokens, type Token } from "../inventory/rust-scan.ts";
import { load } from "./libc-facts.ts";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const argv = process.argv.slice(2);
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const fixture = option("--fixture");
const xnu = option("--xnu");

const broken: string[] = [];
const notes: string[] = [];

// ── the functions that are bound ──

type Bound = { file: string; line: number; name: string; symbol: string; host: string | undefined; variadic: boolean; arguments: string[]; inImage: boolean };

function rustFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "target" && name !== "node_modules") rustFiles(path, out);
    } else if (name.endsWith(".rs")) out.push(path);
  }
  return out;
}

function textOf(list: Token[], from: number, to: number): string {
  let out = "";
  for (let i = from; i <= to; i++) out += (i > from && !["::", "(", ")", ",", "<", ">", "&", "*"].includes(list[i].text) && !["::", "(", "<", "&", "*"].includes(list[i - 1].text) ? " " : "") + list[i].text;
  return out.replace(/\*(const|mut)/g, "*$1 ").replace(/&(mut)(?=\S)/g, "&mut ").replace(/,(?=\S)/g, ", ");
}

function boundIn(path: string): Bound[] {
  const source = readFileSync(path, "utf8");
  if (!source.includes("libSystem")) return [];
  const list = tokens(source);
  const out: Bound[] = [];
  for (let i = 0; i < list.length; i++) {
    // `imports(library = "libSystem" ..)`, as an attribute of its own or inside of cfg_attr.
    if (list[i].text !== "imports" || list[i + 1]?.text !== "(") continue;
    const close = list[i + 1].partner!;
    const inside = list.slice(i + 2, close);
    const value = (key: string) => {
      const at = inside.findIndex((t, k) => t.text === key && inside[k + 1]?.text === "=");
      return at < 0 ? undefined : JSON.parse(inside[at + 2].text);
    };
    if (value("library") !== "libSystem") continue;
    const host = value("host");
    // The block: the next `extern` after the attribute.
    let at = close;
    while (at < list.length && list[at].text !== "extern") at++;
    let open = at + 1;
    if (list[open]?.kind === "literal") open++;
    if (list[open]?.text !== "{") continue;
    const end = list[open].partner!;
    let symbol: string | undefined;
    let inImage = true;
    for (let k = open + 1; k < end; k++) {
      const t = list[k];
      if (t.text === "#" && list[k + 1]?.text === "[") {
        const last = list[k + 1].partner!;
        const attribute = textOf(list, k + 2, last - 1);
        const link = /^link_name = ("[^"]*")$/.exec(attribute);
        if (link) symbol = JSON.parse(link[1]);
        if (/^cfg\(not\(bun_portable\)\)$/.test(attribute.replace(/\s/g, ""))) inImage = false;
        k = last;
        continue;
      }
      if (t.text === "static") {
        broken.push(`${relative(repo, path)}:${t.line}: a variable of macOS cannot be bound through the import table (${list[k + 1]?.text})`);
        continue;
      }
      if (t.text !== "fn" || list[k + 2]?.text !== "(") continue;
      const parameters = list[k + 2];
      const last = parameters.partner!;
      const argumentsOf: string[] = [];
      let start = k + 3;
      let variadic = false;
      for (let a = k + 3; a <= last; a++) {
        const s = list[a];
        if (s.kind === "open" && a < last) {
          a = s.partner!;
          continue;
        }
        if (s.text === "," || a === last) {
          if (a > start) {
            const whole = textOf(list, start, a - 1);
            if (/^\.\.\.?$|^\.\. ?\.$/.test(whole.replace(/\s/g, "")) || whole.replace(/\s/g, "") === "...") variadic = true;
            else argumentsOf.push(whole.replace(/^[A-Za-z_0-9]+ ?: ?/, ""));
          }
          start = a + 1;
        }
      }
      out.push({ file: relative(repo, path), line: t.line, name: list[k + 1].text, symbol: symbol ?? list[k + 1].text, host, variadic, arguments: argumentsOf, inImage });
      symbol = undefined;
      inImage = true;
      k = last;
    }
    i = end;
  }
  return out;
}

const files = fixture ? [resolve(fixture)] : [...rustFiles(join(repo, "src")), ...rustFiles(join(repo, "misctools/portable/slice/src"))];
const bound = files.flatMap(boundIn);

// ── what macOS and the host have ──

const mac = load("aarch64-apple-darwin", work);
const variadicOfMacos = new Set<string>();
for (const [name, items] of mac.byName) for (const item of items) if (item.kind === "function" && item.variadic) variadicOfMacos.add(item.symbol ?? name);
for (const name of ["open", "openat", "fcntl", "ioctl", "syscall", "__syscall", "printf", "fprintf", "sprintf", "snprintf", "dprintf", "asprintf", "scanf", "fscanf", "sscanf", "syslog", "execl", "execle", "execlp", "sem_open", "shm_open"]) {
  variadicOfMacos.add(name);
  variadicOfMacos.add(`${name}$NOCANCEL`);
}
const hostSource = readFileSync(join(here, "../host/host_posix.c"), "utf8");
const shims = new Map<string, number>();
for (const match of hostSource.matchAll(/^static [a-z ]+\b(bun_host_darwin_\w+)\(([^)]*)\) \{/gm)) shims.set(match[1], match[2].split(",").filter(part => part.trim() && part.trim() !== "void").length);
const listed = new Set([...(/#define BUN_HOST_DARWIN_SHIMS\(SHIM\)([\s\S]*?)\n\/\*/.exec(hostSource)?.[1] ?? "").matchAll(/SHIM\((\w+)\)/g)].map(match => match[1]));
const refusedByHost = new Set([...(/static const char \*const variadic_functions\[\] = \{([\s\S]*?)\};/.exec(hostSource)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]));

// ── the rules ──

const narrow = /^(i8|u8|i16|u16|bool|c_char|c_schar|c_uchar|c_short|c_ushort|mode_t|libc::mode_t|libc::c_char|libc::c_short|libc::c_ushort|core::ffi::c_char|core::ffi::c_short|core::ffi::c_ushort|sa_family_t|nlink_t|u_char|u_short)$/;
const integer = /^(i32|u32|i64|u64|isize|usize|c_int|c_uint|c_long|c_ulong|c_longlong|c_ulonglong|(libc::|core::ffi::)?c_(int|uint|long|ulong|longlong|ulonglong)|(libc::)?(off_t|size_t|ssize_t|pid_t|uid_t|gid_t|dev_t|ino_t|socklen_t|nfds_t|clockid_t|time_t|mach_port_t|natural_t|integer_t|vm_size_t|vm_address_t|kern_return_t|copyfile_flags_t|copyfile_state_t|pthread_t|host_t|processor_flavor_t|host_flavor_t|processor_info_array_t|mach_msg_type_number_t|host_info64_t|task_t|vm_map_t|mach_vm_address_t|mach_vm_size_t))$/;
const float = /^(f32|f64|c_float|c_double|(libc::|core::ffi::)?c_(float|double))$/;
const pointer = /^(\*(const|mut) |&|Option<(&|core::ptr::NonNull<|NonNull<|unsafe extern|extern)|core::ptr::NonNull<|NonNull<|unsafe extern "C" fn|extern "C" fn)/;
const widened: string[] = [];
const where = (b: Bound) => `${b.file}:${b.line}: ${b.name}${b.symbol !== b.name ? ` (${b.symbol})` : ""}`;
for (const b of bound) {
  if (b.host !== "macos") broken.push(`R1 ${where(b)}: the block binds libSystem and does not say host = "macos"`);
  if (!b.inImage) continue;
  if (b.variadic) broken.push(`R2 ${where(b)}: declared with a variable number of arguments`);
  if (variadicOfMacos.has(b.symbol)) broken.push(`R2 ${where(b)}: ${b.symbol} takes a variable number of arguments on macOS. Bind a function of the host with fixed ones`);
  if (b.symbol.startsWith("bun_host_darwin_")) {
    const takes = shims.get(b.symbol);
    const named = Number(/(\d+)$/.exec(b.symbol)?.[1]);
    if (takes === undefined || !listed.has(b.symbol)) broken.push(`R3 ${where(b)}: the host has no function ${b.symbol}`);
    else if (takes !== b.arguments.length || named !== takes) broken.push(`R3 ${where(b)}: ${b.arguments.length} arguments in the binding, ${takes} in the host, ${named} in the name`);
  }
  let integers = 0;
  let floats = 0;
  for (const type of b.arguments) {
    if (float.test(type)) floats++;
    else integers++;
    const called = /^(?:Option<)?(?:unsafe )?extern "C" fn\((.*)\)(?: -> (.+?))?>?$/.exec(type);
    if (called) {
      const takes = called[1].trim() ? called[1].split(/,\s*/).map(part => part.replace(/^[A-Za-z_0-9]+ ?: ?/, "")) : [];
      const values = [...takes, ...(called[2] ? [called[2]] : [])];
      if (takes.some(part => /^\.\.\.?$/.test(part.replace(/\s/g, "")))) broken.push(`R6 ${where(b)}: a function of the image with a variable number of arguments: ${type}`);
      for (const value of values.filter(part => !/^\.\.\.?$/.test(part.replace(/\s/g, ""))))
        if (value !== "()" && !integer.test(value) && !float.test(value) && !/^(\*(const|mut) |Option<(core::ptr::)?NonNull<|(core::ptr::)?NonNull<)/.test(value))
          broken.push(`R6 ${where(b)}: a function of the image that takes or returns ${value}: ${type}`);
      if (takes.filter(part => !float.test(part)).length > 8 || takes.filter(part => float.test(part)).length > 8) broken.push(`R6 ${where(b)}: a function of the image with more than 8 arguments of a kind: ${type}`);
    }
    if (narrow.test(type)) widened.push(`${where(b)}: ${type}`);
    else if (!integer.test(type) && !float.test(type) && !pointer.test(type)) broken.push(`R5 ${where(b)}: an argument of the type ${type}, which this tool does not know as an integer, a floating point number or a pointer`);
  }
  if (integers > 8) broken.push(`R4 ${where(b)}: ${integers} integer arguments`);
  if (floats > 8) broken.push(`R4 ${where(b)}: ${floats} floating point arguments`);
}
// What the host hands out by name has to be bound by nothing.
for (const name of variadicOfMacos) if (!name.includes("$") && !refusedByHost.has(name) && ["open", "openat", "fcntl", "ioctl", "syscall"].includes(name)) broken.push(`R2 host/host_posix.c: lookup hands out ${name}, which takes a variable number of arguments`);
for (const name of listed) if (!shims.has(name)) broken.push(`R3 host/host_posix.c: ${name} is in the list of the functions of the host and is not defined`);

if (!fixture) {
  // D1
  const generated = Bun.spawnSync(["bun", join(here, "darwin.ts"), "--check"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, WORK: work } });
  if (generated.exitCode !== 0) broken.push(`D1 ${generated.stdout.toString().trim().split("\n").join("; ")} ${generated.stderr.toString().trim().split("\n").slice(-3).join(" ")}`);

  // D2
  const inImage: Record<string, string> = JSON.parse(readFileSync(join(here, "darwin-errno.json"), "utf8")).in_the_image;
  const inHost = new Map<string, string>();
  const block = /#ifdef __APPLE__\n((?:  \{E[A-Z0-9]+, L_\w+\},[^\n]*\n)+)#endif/.exec(hostSource)?.[1] ?? "";
  for (const match of block.matchAll(/\{(E[A-Z0-9]+), L_(\w+)\}/g)) inHost.set(match[1], match[2] === "BUN_EFTYPE" ? "137" : match[2]);
  for (const [name, image] of Object.entries(inImage)) {
    if (!inHost.has(name)) broken.push(`D2 ${name}: ${image} in the image, and the host has no line for it`);
    else if (inHost.get(name) !== image) broken.push(`D2 ${name}: ${image} in the image, ${inHost.get(name)} in the host`);
  }
  for (const name of inHost.keys()) if (!(name in inImage)) broken.push(`D2 ${name}: in the host, and not in darwin-errno.json`);

  // D3
  if (xnu) {
    const facts = JSON.parse(readFileSync(join(here, "darwin.json"), "utf8"));
    const defined = new Map<string, { value: string; file: string }[]>();
    const headers = ["bsd/sys", "bsd/sys/_types", "osfmk/mach", "bsd/net", "bsd/netinet", "bsd/i386", "bsd/arm", "bsd/machine", "libsyscall/wrappers", "osfmk/mach/machine", "osfmk/kern"].flatMap(dir => {
      const path = join(xnu, dir);
      return existsSync(path) ? readdirSync(path).filter(name => name.endsWith(".h")).map(name => join(path, name)) : [];
    });
    for (const header of headers) {
      for (const match of readFileSync(header, "latin1").matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_][A-Za-z_0-9]*)[ \t]+(.+?)[ \t]*(?:\/\*.*|\/\/.*)?$/gm)) {
        const list = defined.get(match[1]) ?? [];
        list.push({ value: match[2].trim(), file: relative(xnu, header) });
        defined.set(match[1], list);
      }
    }
    const evaluate = (text: string, depth = 0): bigint | undefined => {
      if (depth > 6) return undefined;
      let expression = text.replace(/\(\s*(?:u_?int(?:32|64)?_t|int(?:32|64)?_t|unsigned(?: int| long)?|int|long|short|mode_t|uint16_t|natural_t|mach_msg_type_number_t|__uint32_t|__int32_t|u_int|u_long|tcflag_t|speed_t)\s*\)/g, "");
      expression = expression.replace(/\b(0[xX][0-9a-fA-F]+|\d+)(?:[uU]?[lL]{0,2}|[lL]{1,2}[uU])\b/g, "$1");
      expression = expression.replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g, name => {
        const other = defined.get(name)?.[0];
        const value = other ? evaluate(other.value, depth + 1) : undefined;
        return value === undefined ? `?${name}` : `(${value})`;
      });
      if (expression.includes("?") || !/^[\s0-9a-fA-FxX()|&<>~+\-*]+$/.test(expression)) return undefined;
      expression = expression.replace(/\b0[0-7]+\b/g, octal => `0o${octal.slice(1)}`).replace(/\b(0[xX][0-9a-fA-F]+|0o[0-7]+|\d+)\b/g, "$1n");
      try {
        return BigInt.asIntN(64, new Function(`return (${expression});`)() as bigint);
      } catch {
        return undefined;
      }
    };
    let same = 0;
    let absent = 0;
    for (const constant of facts.constants as { name: string; value: string }[]) {
      const definitions = defined.get(constant.name);
      if (!definitions) {
        absent++;
        continue;
      }
      const values = definitions.map(definition => ({ ...definition, number: evaluate(definition.value) })).filter(definition => definition.number !== undefined);
      if (!values.length) {
        absent++;
        continue;
      }
      const ours = BigInt.asIntN(64, BigInt(constant.value));
      const agree = values.some(v => v.number === ours || BigInt.asUintN(32, v.number!) === BigInt.asUintN(32, ours));
      if (agree) same++;
      else broken.push(`D3 ${constant.name}: ${constant.value} in the bindings, ${values.map(v => `${v.number} in ${v.file}`).join(", ")}`);
    }
    notes.push(`D3: ${same} constants have the number that a header of xnu gives them, ${absent} are not defined with a number there (${facts.constants.length} constants)`);
  } else notes.push("D3: not checked (no --xnu)");
}

const functions = bound.filter(b => b.inImage);
console.log(`${functions.length} functions of macOS are bound in ${new Set(functions.map(b => b.file)).size} files, ${functions.filter(b => b.symbol.startsWith("bun_host_darwin_")).length} of them functions of the host`);
console.log(`arguments that #[imports] passes as 32 bits (${widened.length}):`);
for (const line of widened) console.log(`   ${line}`);
for (const line of notes) console.log(line);
for (const line of broken) console.log(`BROKEN ${line}`);
console.log(broken.length ? `${broken.length} rules are broken` : "every rule holds");
process.exit(broken.length ? 1 : 0);
