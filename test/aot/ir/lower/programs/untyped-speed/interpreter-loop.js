// RUN: lower
// OPTIONS: builtin-modules

// A stack machine: an assembler that resolves labels, and a `switch` over thirteen opcodes in an endless loop that pushes to arrays and pops from them.
var PUSH = 0, ADD = 1, MUL = 2, SUB = 3, DUP = 4, JNZ = 5, LOAD = 6, STORE = 7, LT = 8, HALT = 9, CALL = 10, RET = 11, SWAP = 12;

function assemble(source) {
  var names = { push: PUSH, add: ADD, mul: MUL, sub: SUB, dup: DUP, jnz: JNZ, load: LOAD, store: STORE, lt: LT, halt: HALT, call: CALL, ret: RET, swap: SWAP };
  var code = [];
  var labels = {};
  var fixups = [];
  source.split("\n").forEach(function (line) {
    line = line.trim();
    if (!line) return;
    if (line[line.length - 1] === ":") {
      labels[line.slice(0, -1)] = code.length;
      return;
    }
    var parts = line.split(" ");
    code.push(names[parts[0]]);
    if (parts.length > 1) {
      if (/^-?\d+$/.test(parts[1])) code.push(parseInt(parts[1], 10));
      else {
        fixups.push({ at: code.length, label: parts[1] });
        code.push(0);
      }
    }
  });
  fixups.forEach(function (fixup) {
    code[fixup.at] = labels[fixup.label];
  });
  return code;
}

function execute(code, input) {
  var stack = [];
  var frames = [];
  var locals = [input, 0, 0, 0];
  var pc = 0;
  var steps = 0;
  for (;;) {
    steps++;
    switch (code[pc++]) {
      case PUSH:
        stack.push(code[pc++]);
        break;
      case ADD: {
        var b = stack.pop();
        stack.push(stack.pop() + b);
        break;
      }
      case MUL: {
        var d = stack.pop();
        stack.push((stack.pop() * d) % 1000003);
        break;
      }
      case SUB: {
        var f = stack.pop();
        stack.push(stack.pop() - f);
        break;
      }
      case DUP:
        stack.push(stack[stack.length - 1]);
        break;
      case SWAP: {
        var top = stack.pop();
        var under = stack.pop();
        stack.push(top);
        stack.push(under);
        break;
      }
      case JNZ: {
        var target = code[pc++];
        if (stack.pop() !== 0) pc = target;
        break;
      }
      case LOAD:
        stack.push(locals[code[pc++]]);
        break;
      case STORE:
        locals[code[pc++]] = stack.pop();
        break;
      case LT: {
        var h = stack.pop();
        stack.push(stack.pop() < h ? 1 : 0);
        break;
      }
      case CALL:
        frames.push(pc + 1);
        pc = code[pc];
        break;
      case RET:
        pc = frames.pop();
        break;
      case HALT:
        return stack.pop() + steps;
      default:
        throw new Error("bad opcode at " + (pc - 1));
    }
  }
}

var program = assemble(
  [
    "push 1",
    "store 1",
    "push 0",
    "store 2",
    "loop:",
    "load 1",
    "call step",
    "store 1",
    "load 2",
    "push 1",
    "add",
    "dup",
    "store 2",
    "load 0",
    "lt",
    "jnz loop",
    "load 1",
    "halt",
    "step:",
    "push 3",
    "mul",
    "load 2",
    "add",
    "ret",
  ].join("\n"),
);

function run(rounds) {
  var total = 0;
  for (var i = 0; i < rounds; i++) total = (total + execute(program, 200 + (i & 63))) % 1000000007;
  return total;
}

console.log(run(4000));

// GENERATED: run
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v3, v5)
// CHECK-NEXT: b2(v6, v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Convert v7 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Less v9, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v12, v13):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v17 = Integer integer=200
// CHECK-NEXT: v18 = Convert v12 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v19 = Integer integer=63
// CHECK-NEXT: v20 = BitAnd v18, v19
// CHECK-NEXT: v21 = Add v17, v20
// CHECK-NEXT: v22 = Call v15, -, v16, v21 calleeName="execute"
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v24 = Add v14, v23
// CHECK-NEXT: v25 = Integer integer=1000000007
// CHECK-NEXT: v26 = Mod v24, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Increment v18
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v27, v29)
// CHECK-NEXT: b6(v30, v31):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v32 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
