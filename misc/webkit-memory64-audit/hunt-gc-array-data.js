// CATEGORY: WasmGC array.new_data / array.init_data vs memory64.
//
// Per spec (and per orchestrator correction): array.new_data / array.init_data read
// from PASSIVE DATA SEGMENTS, not linear memory. Their offset/size operands are ALWAYS
// i32 regardless of whether the module declares (memory i64 ...). No WasmGC array
// instruction addresses linear memory directly, so memory64 should not affect them.
//
// This test therefore VERIFIES that:
//   (a) modules with (memory i64 N) + GC array.new_data/init_data validate & run,
//   (b) the validator still requires i32 operands (i64 operands => CompileError),
//   (c) i32 edge-case offset/size values trap identically with/without memory64,
//   (d) active-data-segment (i64 offset) interaction: after instantiation the active
//       segment is dropped, so array.new_data on it sees length 0.
//
// Neither JSTests/wasm/libwabt.js (no GC) nor JSTests/wasm/gc/wast.js (no memory64)
// can emit a module combining both, so we hand-encode the binaries below.
//
// Output format: NAME<tab>RESULT   (RESULT one of: OK:<val>, TRAP, COMPILE_ERR, LINK_ERR, ERR:<msg>)

// wabt-wrapper import kept so the harness shape matches the other m64-fuzz tests.
import { instantiate } from "../JSTests/wasm/wabt-wrapper.js";
const wabtOpts = { memory64: true, threads: true, reference_types: true, bulk_memory: true, gc: true, exceptions: true };
void instantiate; void wabtOpts;

// ---------------------------------------------------------------------------
// Tiny wasm binary builder
// ---------------------------------------------------------------------------
function u(n) { // unsigned LEB128
  n = BigInt(n);
  const out = [];
  while (true) {
    let b = Number(n & 0x7Fn);
    n >>= 7n;
    if (n === 0n) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}
function s(n) { // signed LEB128
  n = BigInt(n);
  const out = [];
  while (true) {
    let b = Number(n & 0x7Fn);
    n >>= 7n;
    const done = (n === 0n && !(b & 0x40)) || (n === -1n && (b & 0x40));
    if (done) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}
function section(id, body) { return [id, ...u(body.length), ...body]; }
function vec(items) { return [...u(items.length), ...items.flat()]; }
function str(x) { const b = [...x].map(c => c.charCodeAt(0)); return [...u(b.length), ...b]; }

const I32 = 0x7F, I64 = 0x7E;

// Build a module:
//   type $a = array (mut i8)          -- index 0
//   type $f = func (params) -> (results)  -- index 1
//   memory: none | i32(1) | i64(1)
//   data: passive "ABCDEFGH" OR active (i64.const 0) "ABCDEFGH"
//   func f(params) -> results : <bodyBytes>
function buildModule({ mem, params, results, body, activeData, elemType }) {
  elemType = elemType ?? 0x78; // i8
  const bytes = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];

  // Type section
  bytes.push(...section(1, vec([
    [0x5E, elemType, 0x01],                   // array (mut <elemType>)
    [0x60, ...u(params.length), ...params, ...u(results.length), ...results],
  ])));

  // Function section
  bytes.push(...section(3, vec([[...u(1)]]))); // one func, type index 1

  // Memory section
  if (mem === "i32") bytes.push(...section(5, vec([[0x00, ...u(1)]])));
  if (mem === "i64") bytes.push(...section(5, vec([[0x04, ...u(1)]])));

  // Export section: "f" -> func 0
  bytes.push(...section(7, vec([[...str("f"), 0x00, ...u(0)]])));

  // DataCount section
  bytes.push(...section(12, [...u(1)]));

  // Code section
  const code = [0x00 /*locals*/, ...body, 0x0B];
  bytes.push(...section(10, vec([[...u(code.length), ...code]])));

  // Data section
  let seg;
  if (activeData) {
    // active, mem 0, i64.const 0, "ABCDEFGH"
    seg = [0x00, 0x42, ...s(0n), 0x0B, ...str("ABCDEFGH")];
  } else {
    seg = [0x01, ...str("ABCDEFGH")]; // passive
  }
  bytes.push(...section(11, vec([seg])));

  return new Uint8Array(bytes);
}

// Instruction helpers
const local_get = i => [0x20, ...u(i)];
const i32_const = n => [0x41, ...s(n)];
const i64_const = n => [0x42, ...s(n)];
const array_new_data     = (t, d) => [0xFB, 0x09, ...u(t), ...u(d)];
const array_new_default  = t => [0xFB, 0x07, ...u(t)];
const array_init_data    = (t, d) => [0xFB, 0x12, ...u(t), ...u(d)];
const array_get_u        = t => [0xFB, 0x0D, ...u(t)];
const array_get          = t => [0xFB, 0x0B, ...u(t)];
const array_len          = [0xFB, 0x0F];
const drop               = [0x1A];

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
function classify(e) {
  if (e instanceof WebAssembly.CompileError) return "COMPILE_ERR";
  if (e instanceof WebAssembly.LinkError)    return "LINK_ERR";
  if (e instanceof WebAssembly.RuntimeError) return "TRAP";
  return "ERR:" + String(e.message || e).slice(0, 80);
}
function T(name, fn) {
  try {
    const r = fn();
    print(name + "\t" + "OK:" + String(r));
  } catch (e) {
    print(name + "\t" + classify(e));
  }
}

// Precompile parametric modules once per (mem, elemType) so we can sweep args.
function makeNewDataLen(mem, elemType) {
  // f(offset:i32, size:i32) -> i32  : (array.new_data $a $d off size).len
  const bin = buildModule({
    mem, elemType,
    params: [I32, I32], results: [I32],
    body: [...local_get(0), ...local_get(1), ...array_new_data(0, 0), ...array_len],
  });
  return new WebAssembly.Instance(new WebAssembly.Module(bin)).exports.f;
}
function makeNewDataGet0(mem) {
  // f(offset:i32, size:i32) -> i32  : (array.new_data $a $d off size)[0]
  const bin = buildModule({
    mem, elemType: 0x78,
    params: [I32, I32], results: [I32],
    body: [...local_get(0), ...local_get(1), ...array_new_data(0, 0), ...i32_const(0), ...array_get_u(0)],
  });
  return new WebAssembly.Instance(new WebAssembly.Module(bin)).exports.f;
}
function makeInitDataGet0(mem) {
  // f(dstOff:i32, srcOff:i32, size:i32) -> i32 :
  //   a = array.new_default $a 8 ; array.init_data a dstOff srcOff size ; a[0]
  const bin = buildModule({
    mem, elemType: 0x78,
    params: [I32, I32, I32], results: [I32],
    body: [
      ...i32_const(8), ...array_new_default(0),            // -> a
      ...local_get(0), ...local_get(1), ...local_get(2),   // dstOff srcOff size
      ...array_init_data(0, 0),
      // make another array to read from (the first was consumed); actually we need
      // to keep the ref around. Redo with a different structure:
    ],
  });
  // The above body is wrong because array.init_data consumes the ref. Rebuild
  // using locals via a slightly different approach below instead.
  void bin;
  // f(dstOff,srcOff,size) -> i32 : new_default 8 ; (dup via set/get) init_data ; get[0]
  // Since wasm has no dup, declare a ref local: do it via block param? Simpler:
  // call init_data then re-create the array won't show the write. Instead we only
  // observe trap/no-trap: return 1 on success.
  const bin2 = buildModule({
    mem, elemType: 0x78,
    params: [I32, I32, I32], results: [I32],
    body: [
      ...i32_const(8), ...array_new_default(0),
      ...local_get(0), ...local_get(1), ...local_get(2),
      ...array_init_data(0, 0),
      ...i32_const(1),
    ],
  });
  return new WebAssembly.Instance(new WebAssembly.Module(bin2)).exports.f;
}

// ---------------------------------------------------------------------------
// Section 0: self-test that hand-encoding is valid at all.
// ---------------------------------------------------------------------------
T("self/no-mem/new_data/0,4", () => makeNewDataLen(null, 0x78)(0, 4));
T("self/no-mem/new_data/get0/0,4", () => makeNewDataGet0(null)(0, 4)); // 'A' == 65

// ---------------------------------------------------------------------------
// Section 1: memory64 presence must NOT alter array.new_data typing (operands i32)
// ---------------------------------------------------------------------------
for (const mem of [null, "i32", "i64"]) {
  const tag = mem === null ? "nomem" : mem;

  // i64 OFFSET must be a CompileError regardless of mem kind.
  T(`typing/${tag}/new_data/i64-offset`, () => {
    const bin = buildModule({
      mem, elemType: 0x78,
      params: [], results: [I32],
      body: [...i64_const(0n), ...i32_const(4), ...array_new_data(0, 0), ...array_len],
    });
    new WebAssembly.Module(bin);
    return "validated"; // should NOT reach here
  });
  // i64 SIZE must be a CompileError regardless of mem kind.
  T(`typing/${tag}/new_data/i64-size`, () => {
    const bin = buildModule({
      mem, elemType: 0x78,
      params: [], results: [I32],
      body: [...i32_const(0), ...i64_const(4n), ...array_new_data(0, 0), ...array_len],
    });
    new WebAssembly.Module(bin);
    return "validated";
  });
  // i64 SRC OFFSET for array.init_data must be CompileError.
  T(`typing/${tag}/init_data/i64-srcOff`, () => {
    const bin = buildModule({
      mem, elemType: 0x78,
      params: [], results: [I32],
      body: [
        ...i32_const(8), ...array_new_default(0),
        ...i32_const(0), ...i64_const(0n), ...i32_const(4),
        ...array_init_data(0, 0),
        ...i32_const(1),
      ],
    });
    new WebAssembly.Module(bin);
    return "validated";
  });
}

// ---------------------------------------------------------------------------
// Section 2: runtime behaviour parity: (memory i32) vs (memory i64) vs no-mem.
// Data segment is "ABCDEFGH" (8 bytes). Passive => not dropped.
// ---------------------------------------------------------------------------
const i32Edges = [
  0n, 1n, 7n, 8n, 9n,
  2n**31n - 1n,  // INT32_MAX
  2n**31n,       // INT32_MIN as unsigned 2147483648
  2n**32n - 8n,  // 4294967288
  2n**32n - 1n,  // UINT32_MAX
];
const sizes = [0n, 1n, 4n, 8n, 9n];

for (const mem of [null, "i32", "i64"]) {
  const tag = mem === null ? "nomem" : mem;
  let lenFn, initFn;
  T(`compile/${tag}/new_data`, () => { lenFn = makeNewDataLen(mem, 0x78); return "compiled"; });
  T(`compile/${tag}/init_data`, () => { initFn = makeInitDataGet0(mem); return "compiled"; });
  if (!lenFn || !initFn) continue;

  for (const off of i32Edges) for (const sz of sizes) {
    const o = Number(BigInt.asIntN(32, off));    // pass as JS number; wasm sees as i32
    const z = Number(BigInt.asIntN(32, sz));
    T(`run/${tag}/new_data/off=${off}/size=${sz}`, () => lenFn(o, z));
    T(`run/${tag}/init_data/dstOff=0/srcOff=${off}/size=${sz}`, () => initFn(0, o, z));
  }
}

// ---------------------------------------------------------------------------
// Section 3: array of i64 elements -- exercises elementSize==8 multiply path.
// ---------------------------------------------------------------------------
for (const mem of [null, "i64"]) {
  const tag = mem === null ? "nomem" : mem;
  let lenFn;
  T(`compile/${tag}/new_data/i64elem`, () => { lenFn = makeNewDataLen(mem, I64); return "compiled"; });
  if (!lenFn) continue;
  for (const off of [0n, 1n, 2n**29n, 2n**31n - 1n, 2n**31n, 2n**32n - 1n])
    for (const sz of [0n, 1n, 2n**29n, 2n**31n - 1n]) {
      const o = Number(BigInt.asIntN(32, off));
      const z = Number(BigInt.asIntN(32, sz));
      T(`run/${tag}/new_data/i64elem/off=${off}/size=${sz}`, () => lenFn(o, z));
    }
}

// ---------------------------------------------------------------------------
// Section 4: active data segment in memory64 module (i64 offset) -> segment is
// dropped after instantiation, so array.new_data should see length 0: any nonzero
// read traps; (off=0,size=0) succeeds with length 0.
// ---------------------------------------------------------------------------
{
  let f;
  T(`compile/i64/new_data/active-seg`, () => {
    const bin = buildModule({
      mem: "i64", elemType: 0x78, activeData: true,
      params: [I32, I32], results: [I32],
      body: [...local_get(0), ...local_get(1), ...array_new_data(0, 0), ...array_len],
    });
    f = new WebAssembly.Instance(new WebAssembly.Module(bin)).exports.f;
    return "compiled";
  });
  if (f) {
    T(`run/i64/new_data/active-seg/0,0`, () => f(0, 0));
    T(`run/i64/new_data/active-seg/0,1`, () => f(0, 1));
    T(`run/i64/new_data/active-seg/0,8`, () => f(0, 8));
  }
}

// ---------------------------------------------------------------------------
// CONCLUSION line (for the diff to stay aligned)
// ---------------------------------------------------------------------------
print("CATEGORY\tgc-array-data\tNOTE\tarray.new_data/init_data use data-segment (i32) offsets; no GC array op addresses linear memory -> memory64 N/A");
