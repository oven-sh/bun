// Which requests a function of the libc of the image sends to the host, and which requests the host
// answers.
//
// The libc is musl: a function is a file of its source tree, and a request is a `SYS_<name>` in it, or in
// a function of the libc that it calls. The host is host/host_posix.c: a request is answered if the
// function `dispatch` has a `case N_<name>` for it that does something else than to refuse it.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Arch = "x86_64" | "aarch64";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

export class Musl {
  /** function name -> the files that define it */
  private definedIn = new Map<string, string[]>();
  private requestsOfArch: Set<string>;
  private cache = new Map<string, { requests: Set<string>; calls: Set<string>; commands: Set<string> }>();

  constructor(
    readonly root: string,
    readonly arch: Arch,
  ) {
    const numbers = readFileSync(join(root, "arch", arch, "bits/syscall.h.in"), "utf8");
    this.requestsOfArch = new Set([...numbers.matchAll(/^#define __NR_(\w+)\s/gm)].map(m => m[1]));
    const files = walk(join(root, "src")).filter(path => /\.(c|s|S)$/.test(path));
    // A directory of an architecture replaces the file of the same name one level up.
    const chosen = new Map<string, string>();
    for (const path of files) {
      const parts = path.slice(root.length + 1).split("/");
      const archDir = parts.length === 4 ? parts[2] : undefined;
      if (archDir && archDir !== arch) continue;
      const key = (archDir ? [parts[0], parts[1], parts[3]] : parts).join("/").replace(/\.(c|s|S)$/, "");
      if (archDir || !chosen.has(key)) chosen.set(key, path);
    }
    for (const path of chosen.values()) {
      if (!path.endsWith(".c")) {
        const text = readFileSync(path, "utf8");
        for (const m of text.matchAll(/^\.global\s+(\w+)/gm)) this.define(m[1], path);
        continue;
      }
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/^(?:[A-Za-z_][\w \t\*]*?[ \*])?(\w+)\s*\([^;{}]*\)\s*\{/gm)) if (!/^(if|for|while|switch|return|sizeof|__attribute__|dummy\w*)$/.test(m[1])) this.define(m[1], path);
      for (const m of text.matchAll(/^(?:weak_alias|strong_alias)\(\s*(\w+)\s*,\s*(\w+)\s*\)/gm)) this.define(m[2], path);
    }
  }

  private define(name: string, path: string) {
    const list = this.definedIn.get(name) ?? [];
    if (!list.includes(path)) list.push(path);
    this.definedIn.set(name, list);
  }

  has(name: string): boolean {
    return this.definedIn.has(name);
  }

  files(name: string): string[] {
    return (this.definedIn.get(name) ?? []).map(path => path.slice(this.root.length + 1));
  }

  /** The text of a file with the branches of `#ifdef SYS_x` that this architecture does not take removed. */
  private active(path: string): string {
    const out: string[] = [];
    const stack: { keep: boolean; known: boolean }[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const directive = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b\s*(.*)$/.exec(line);
      if (directive) {
        const [, word, rest] = directive;
        const sys = /^(?:defined\s*\(?\s*)?SYS_(\w+)\)?\s*$/.exec(rest.trim());
        if (word === "ifdef" || word === "ifndef" || word === "if") {
          if (sys && word !== "if") stack.push({ keep: this.requestsOfArch.has(sys[1]) === (word === "ifdef"), known: true });
          else if (sys) stack.push({ keep: this.requestsOfArch.has(sys[1]), known: true });
          else stack.push({ keep: true, known: false });
        } else if (word === "else" || word === "elif") {
          const top = stack[stack.length - 1];
          if (top?.known) top.keep = !top.keep && (word === "else" || !sys || this.requestsOfArch.has(sys[1]));
        } else stack.pop();
        continue;
      }
      if (stack.every(entry => entry.keep)) out.push(line);
    }
    return out.join("\n");
  }

  private direct(name: string): { requests: Set<string>; calls: Set<string>; commands: Set<string> } {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const requests = new Set<string>();
    const calls = new Set<string>();
    const commands = new Set<string>();
    for (const path of this.definedIn.get(name) ?? []) {
      if (!path.endsWith(".c")) {
        // Assembly: the patch of the image keeps a `syscall` or `svc` instruction for Linux only.
        continue;
      }
      const text = this.active(path);
      for (const m of text.matchAll(/\bSYS_(\w+)\b/g)) if (this.requestsOfArch.has(m[1])) requests.add(m[1]);
      // Macros of the libc that stand for a request: sys_open, sys_wait4_cp.
      for (const m of text.matchAll(/\b(?:__)?sys_(open|wait4)\w*\(/g)) requests.add(m[1] === "open" && !this.requestsOfArch.has("open") ? "openat" : m[1]);
      for (const [caller, request] of forwarders) if (caller === name && this.requestsOfArch.has(request)) requests.add(request);
      // The calls of the network go through a macro that makes the name of the request.
      for (const m of text.matchAll(/\bsocketcall(?:_cp)?\(\s*(\w+)\s*,/g)) if (this.requestsOfArch.has(m[1])) requests.add(m[1]);
      for (const m of text.matchAll(/\b(F_[A-Z_]+|TIOC[A-Z]+|TC(?:GETS|SETS[WF]?|SBRK|XONC|FLSH)|FIO[A-Z]+|PR_[A-Z_]+|MADV_[A-Z_]+)\b/g)) commands.add(m[1]);
      for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) if (m[1] !== name && this.definedIn.has(m[1])) calls.add(m[1]);
    }
    const found = { requests, calls, commands };
    this.cache.set(name, found);
    return found;
  }

  /** Whether the function is one of the parts of the libc that ask the host for what their name says. */
  private asksForItself(name: string): boolean {
    return (this.definedIn.get(name) ?? []).every(path => /\/src\/(unistd|stat|fcntl|dirent|linux|mman|process|signal|time|sched|select|network|misc|ipc|termios|temp|passwd|conf|stdio|env)\//.test(path)) && !notFollowed.test(name);
  }

  /** Requests of the function itself, and of the functions it calls, up to two calls deep. A function of
      the same file is followed, and one whose part of the libc is about files, processes, signals,
      time or the network. */
  requests(name: string): { own: string[]; through: Record<string, string[]>; commands: string[] } {
    const own = [...this.direct(name).requests].sort();
    const commands = new Set(this.direct(name).commands);
    const through: Record<string, string[]> = {};
    const seen = new Set([name]);
    const files = new Set(this.definedIn.get(name) ?? []);
    let level = [...this.direct(name).calls];
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      for (const callee of level) {
        if (seen.has(callee) || notFollowed.test(callee)) continue;
        const sameFile = (this.definedIn.get(callee) ?? []).some(path => files.has(path));
        if (!sameFile && !this.asksForItself(callee)) continue;
        seen.add(callee);
        if ((this.definedIn.get(callee) ?? []).length > 2) continue;
        const found = this.direct(callee);
        for (const command of found.commands) commands.add(command);
        const list = [...found.requests].filter(r => !own.includes(r)).sort();
        if (list.length) through[callee] = list;
        next.push(...found.calls);
      }
      level = next;
    }
    return { own, through, commands: [...commands].sort() };
  }
}

/** Functions that ask through a part of the libc that is not followed. */
const forwarders: [string, string][] = [
  ["sigprocmask", "rt_sigprocmask"],
  ["pthread_sigmask", "rt_sigprocmask"],
  ["pthread_kill", "tkill"],
  ["sigwait", "rt_sigtimedwait"],
];

/** Functions that the libc of the image answers without the host, in the way of Linux: on macOS the answer
    comes from somewhere else, and no request tells the host. */
export const answeredTheWayOfLinux: { names: RegExp; why: string }[] = [
  { names: /^dl(open|sym|close|error|addr)$/, why: "the image is linked statically and its libc has no loader: the call fails. bun for macOS loads libraries with the dynamic linker of the system" },
  { names: /^get(pw|gr)(nam|uid|gid|ent)(_r)?$/, why: "musl reads /etc/passwd and /etc/group. macOS keeps users in Directory Services" },
  { names: /^(getaddrinfo|getnameinfo|gethostbyname\w*|gethostbyaddr\w*|res_\w+)$/, why: "musl reads /etc/resolv.conf and /etc/hosts and asks the name servers itself. macOS resolves through its own service" },
  { names: /^(getifaddrs|freeifaddrs|if_nameindex|if_nametoindex|if_indextoname)$/, why: "musl asks the kernel of Linux through a netlink socket" },
  { names: /^(ttyname|ttyname_r|ptsname|ptsname_r|fexecve|ctermid)$/, why: "musl reads /proc/self/fd, which no other system has" },
  { names: /^(sysconf|getauxval|get_nprocs\w*|get_phys_pages|get_avphys_pages)$/, why: "some of the values are the ones of Linux, or come from the start of the image" },
  { names: /^(openpty|forkpty|posix_openpt|grantpt|unlockpt)$/, why: "musl opens /dev/ptmx and uses the ioctl numbers of Linux" },
  { names: /^(sem_open|shm_open|mq_open)$/, why: "musl makes them from files under /dev/shm" },
];

/** Functions whose requests say nothing about the caller: memory, strings, locks, the error number, exits. */
const notFollowed =
  /^(__aio_\w+|__procfdname|__fork_handler|__post_Fork|__tsd_\w+|__funcs_on_\w+|__libc_exit_fini|__stdio_exit\w*|__randname|__membarrier|__synccall|__env_rm_add|__putenv|malloc|calloc|realloc|free|aligned_alloc|posix_memalign|__libc_\w+|__bun_libc_\w+|mem\w+|str\w+|stp\w+|wcs\w+|wmem\w+|__lock|__unlock|__lockfile|__unlockfile|__wait|__wake|__timedwait\w*|__syscall_ret|__syscall_cp\w*|__errno_location|abort|exit|_Exit|_exit|a_crash|__block_\w+|__restore_sigs|__pthread_\w+|pthread_\w+|__tl_\w+|__vm_\w+|__synccall|raise|printf|fprintf|sprintf|snprintf|vsnprintf|vfprintf|__fwritex|__towrite|__toread|__overflow|__uflow|f(open|close|read|write|flush|gets|puts|seek|tell)\w*|qsort\w*|getenv|__init_\w+|__dl_\w+|dl\w+|sysconf|__clock_gettime|clock_gettime|time|__map_file|__get_locale|setlocale|__ofl_\w+)$/;

export type HostAnswer = { request: string; macos: boolean; linux_test_host: boolean; refused: boolean; note?: string; commands?: string[] };

/** The requests that `dispatch` of host_posix.c has a case for, and for which hosts that case is compiled. */
export function hostAnswers(hostSource: string): Map<string, HostAnswer> {
  const text = readFileSync(hostSource, "utf8");
  const start = text.indexOf("static long dispatch(");
  const end = text.indexOf("\n}\n", start);
  if (start < 0 || end < 0) throw new Error(`${hostSource}: no function dispatch`);
  const lines = text.slice(start, end).split("\n");
  const out = new Map<string, HostAnswer>();
  // Which of the two hosts compiles the line.
  const stack: { apple: boolean; linux: boolean }[] = [];
  const condition = (rest: string, negate: boolean) => {
    const apple = /__APPLE__/.test(rest);
    const linux = /__linux__/.test(rest);
    if (apple) return { apple: !negate, linux: negate };
    if (linux) return { apple: negate, linux: !negate };
    return { apple: true, linux: true };
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const directive = /^\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b\s*(.*)$/.exec(line);
    if (directive) {
      const [, word, rest] = directive;
      if (word === "ifdef" || word === "if") stack.push(condition(rest, false));
      else if (word === "ifndef") stack.push(condition(rest, true));
      else if (word === "else" || word === "elif") {
        const top = stack.pop()!;
        stack.push({ apple: !top.apple || (top.apple && top.linux), linux: !top.linux || (top.apple && top.linux) });
      } else stack.pop();
      continue;
    }
    const labels = [...line.matchAll(/\bcase N_(\w+)\s*:/g)].map(m => m[1]);
    if (!labels.length) continue;
    const after = line.slice(line.lastIndexOf(`case N_${labels[labels.length - 1]}`)).replace(/^case N_\w+\s*:/, "").trim();
    // The statement is on this line, or on the next ones up to the next case.
    let statement = after;
    for (let k = i + 1; !statement && k < lines.length && !/\bcase N_|\bdefault:/.test(lines[k]); k++) statement = lines[k].trim().startsWith("/*") || lines[k].trim().startsWith("*") || !lines[k].trim() ? "" : lines[k].trim();
    const refused = /^return -L_ENOSYS;/.test(statement);
    const apple = stack.every(entry => entry.apple);
    const linux = stack.every(entry => entry.linux);
    for (const request of labels) out.set(request, { request, macos: apple && !refused, linux_test_host: linux && !refused, refused });
  }
  // Requests that are answered for some of their commands only.
  const commands = (fn: string, prefix: RegExp) => {
    const at = text.indexOf(`static long ${fn}(`);
    if (at < 0) return [];
    const body = text.slice(at, text.indexOf("\n}\n", at));
    return [...new Set([...body.matchAll(/\bcase (L_\w+)\s*:/g)].map(m => m[1]).filter(name => prefix.test(name)))];
  };
  const note = (request: string, list: string[]) => {
    const answer = out.get(request);
    if (answer) {
      answer.note = `only ${list.map(name => name.slice(2)).join(", ")}`;
      answer.commands = list.map(name => name.slice(2));
    }
  };
  note("fcntl", commands("host_fcntl", /^L_F_/));
  note("ioctl", commands("host_ioctl", /^L_(TIO|FIO|TC)/));
  note("prctl", commands("host_prctl", /^L_PR_/));
  note("madvise", commands("host_madvise", /^L_MADV_/));
  return out;
}

export function muslRoot(work: string, arch: Arch): string | undefined {
  const path = join(work, `musl-${arch}`, "musl");
  return existsSync(join(path, "src")) ? path : undefined;
}
