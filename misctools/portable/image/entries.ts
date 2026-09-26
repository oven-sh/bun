// Finds, in a portable image (x86-64), every function that checks the slot of the thread pointer the
// way a function does that the host OS calls, and says what the function does before the check.
//
//   bun entries.ts <image> [--list]
//
// A thread that the image did not create has no thread pointer until the check has run
// (bun_windows_sys::host_thread::enter, which bun_portable_macros::win_abi writes at the start of a
// body). What needs the thread pointer is: a call (of the C library, of the allocator, of the access
// to a thread-local, which is a call in the image), an access through fs or gs, a request to the
// kernel. None of them may stand between the first instruction of the function and the check: the
// compiler is free to move what it can prove to be the same, and this is where it is looked at.
//
// The check is recognised by its two loads: the offset of the slot from __bun_tp_offset, then the
// slot through gs with that offset. Where the compiler wrote the check (C and C++, a call of
// __sanitizer_cov_trace_pc, which is __bun_thread_enter of the C library), the call is the check.
//
// Exit code 1 if a function does something of the above before its check.
import { resolve } from "node:path";

const args = process.argv.slice(2);
const image = args.find(a => !a.startsWith("--"));
if (!image) throw new Error("usage: bun entries.ts <image> [--list]");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";

function output(cmd: string[]) {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 30 });
  if (result.exitCode !== 0) throw new Error(`${cmd[0]}: ${result.stderr.toString().slice(0, 400)}`);
  return result.stdout.toString();
}

const symbols = output([`${llvm}/llvm-nm`, "--defined-only", resolve(image)]);
const offsetSymbol = /^([0-9a-f]+) . __bun_tp_offset$/m.exec(symbols);
if (!offsetSymbol) throw new Error(`${image} has no __bun_tp_offset: it is not an image whose C library adopts threads`);
const offsetAddress = parseInt(offsetSymbol[1], 16);

type Found = { function: string; at: string; check: "inline" | "call"; instructions_before: number; before_the_check: string[] };
const found: Found[] = [];
let name = "";
let body: { address: string; text: string }[] = [];
let previous: { address: string; text: string } | undefined;
const needsTheThreadPointer = /^(call|syscall|sysenter|int\s)|%fs:|%gs:/;
let address = "";
for (const line of output([`${llvm}/llvm-objdump`, "-d", "--no-show-raw-insn", "--print-imm-hex", resolve(image)]).split("\n")) {
  const label = /^[0-9a-f]+ <(.+)>:$/.exec(line);
  if (label) {
    name = label[1];
    body = [];
    previous = undefined;
    continue;
  }
  const instruction = /^\s*([0-9a-f]+):\s+(.*)$/.exec(line);
  if (!instruction) continue;
  address = instruction[1];
  const text = instruction[2].replace(/\s+/g, " ").trim();
  // movq 0x1234(%rip), %rax   # 0x30c00 <__bun_tp_offset>      and then      movq %gs:(%rax), %rax
  if (/^callq? .*<(__sanitizer_cov_trace_pc|__bun_thread_enter)>$/.test(text) && !/^(__sanitizer_cov_trace_pc|__bun_thread_enter)$/.test(name)) {
    found.push({
      function: name,
      at: address,
      check: "call",
      instructions_before: body.length,
      before_the_check: body.filter(i => needsTheThreadPointer.test(i.text)).map(i => `${i.address}: ${i.text}`),
    });
  }
  const slot = /^movq? %gs:\(%(r[a-z0-9]+)\), /.exec(text);
  if (slot && previous) {
    const load = new RegExp(`^movq? .*\\(%rip\\), %${slot[1]}\\b.*# 0x([0-9a-f]+)`).exec(previous.text);
    if (load && parseInt(load[1], 16) === offsetAddress && !/^(__sanitizer_cov_trace_pc|__bun_thread_enter)$/.test(name)) {
      const before = body.slice(0, -1);
      found.push({
        function: name,
        at: address,
        check: "inline",
        instructions_before: before.length,
        before_the_check: before.filter(i => needsTheThreadPointer.test(i.text)).map(i => `${i.address}: ${i.text}`),
      });
    }
  }
  previous = { address, text };
  body.push(previous);
}

const late = found.filter(f => f.before_the_check.length > 0);
console.log(
  JSON.stringify(
    {
      image: resolve(image),
      functions_that_check: found.length,
      check_written_by_the_compiler: found.filter(f => f.check === "call").length,
      most_instructions_before_a_check: found.reduce((most, f) => Math.max(most, f.instructions_before), 0),
      functions_that_need_the_thread_pointer_before_their_check: late,
      ...(args.includes("--list") ? { functions: found.map(f => ({ function: f.function, check: f.check, instructions_before: f.instructions_before })) } : {}),
    },
    null,
    1,
  ),
);
process.exit(late.length ? 1 : 0);
