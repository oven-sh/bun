// Test memory64 with actual memory sizes near and over 4GB.
// This requires a machine with >4GB RAM and overcommit.
import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";

async function main() {
  // 65537 pages = 4GB + 64KB (just over 4GB)
  const pages = 65537n;
  print(`Attempting ${pages} pages = ${Number(pages * 65536n) / (1024**3)}GB...`);

  const wat = `
  (module
    (memory (export "mem") i64 ${pages})
    (func (export "st") (param i64 i32) local.get 0 local.get 1 i32.store)
    (func (export "ld") (param i64) (result i32) local.get 0 i32.load)
    (func (export "ald") (param i64) (result i32) local.get 0 i32.atomic.load)
  )`;

  let inst;
  try {
    inst = await instantiate(wat, {}, { memory64: true, threads: true });
  } catch (e) {
    print("instantiate failed (likely OOM or size limit): " + String(e).slice(0, 200));
    return;
  }
  print("instantiated, buffer byteLength=" + inst.exports.mem.buffer.byteLength);
  const e = inst.exports;

  // Write/read at 4GB exactly (0x100000000)
  const hi = 0x100000000n;
  e.st(hi, 0xCAFEBABE | 0);
  let v = e.ld(hi);
  print(`ld(4GB) = 0x${(v>>>0).toString(16)} (expect cafebabe)`);
  if ((v>>>0) !== 0xCAFEBABE) { print("FAIL: wrong value at 4GB"); $vm.abort(); }

  // Write at 0, make sure it's different
  e.st(0n, 0x11111111);
  v = e.ld(0n);
  print(`ld(0) = 0x${(v>>>0).toString(16)} (expect 11111111)`);
  if ((v>>>0) !== 0x11111111) { print("FAIL: wrong value at 0"); $vm.abort(); }

  // Re-read 4GB to make sure no aliasing
  v = e.ld(hi);
  print(`ld(4GB) again = 0x${(v>>>0).toString(16)} (expect cafebabe)`);
  if ((v>>>0) !== 0xCAFEBABE) {
    print("FAIL: value at 4GB changed after writing to 0 (address aliasing!)");
    $vm.abort();
  }

  // Atomic load at 4GB
  v = e.ald(hi);
  print(`ald(4GB) = 0x${(v>>>0).toString(16)} (expect cafebabe)`);
  if ((v>>>0) !== 0xCAFEBABE) { print("FAIL: atomic load at 4GB returned wrong value"); $vm.abort(); }

  // OOB access at end of memory
  const end = pages * 65536n;
  let trapped = false;
  try { e.ld(end); } catch (err) { trapped = err instanceof WebAssembly.RuntimeError; }
  print(`ld(${end}) trapped=${trapped} (expect true)`);
  if (!trapped) { print("FAIL: ld at memory end did not trap"); $vm.abort(); }

  // Last valid 4-byte access
  e.st(end - 4n, 0x22222222);
  v = e.ld(end - 4n);
  print(`ld(end-4) = 0x${(v>>>0).toString(16)} (expect 22222222)`);
  if ((v>>>0) !== 0x22222222) { print("FAIL"); $vm.abort(); }

  print("PASS: large memory over 4GB works");
}

await main().catch(e => { print("FATAL: " + e.stack); $vm.abort(); });
