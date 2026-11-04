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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v3, v5)
// CHECK-NEXT: b1(v6, v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Less v7, v0
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = Integer integer=200
// CHECK-NEXT: v13 = Integer integer=63
// CHECK-NEXT: v14 = BitAnd v7, v13
// CHECK-NEXT: v15 = Add v12, v14
// CHECK-NEXT: v16 = Call v10, -, v11, v15 calleeName="execute"
// CHECK-NEXT: v17 = Add v6, v16
// CHECK-NEXT: v18 = Integer integer=1000000007
// CHECK-NEXT: v19 = Mod v17, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v21 = Increment v7
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v20, v22)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
