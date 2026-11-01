// Flags: --aot-disable=InlineCalls
// COUNT: operation:operationAOTFindLandingOfMisfit <= 200
// A function that promises the type of its result hands what does not fit to the caller's landing, or to the caller as it is. Which of the two a caller is is looked up once for each caller,
// however many callers there are: the run counts the lookups. 160 callers take turns, so none of them may take the place of another in what is remembered.
class Op {
  constructor(readonly tag: number) {}
  run(by: number): number {
    return this.tag * by;
  }
}
// What goes through it the build knows nothing about.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6)) as <T>(value: T) => T;
class Fiber {
  readonly stack: Array<Op> = [];
  next(wanted: number): Op | undefined {
    const op = this.stack.pop();
    return wanted >= 0 ? op : undefined;
  }
}
const other: Op = hide({ tag: 5, run: (by: number) => by + 1 } as unknown as Op);
let sum = 0;
function keep(value: unknown): number {
  sum += (value as Op).tag;
  return 1;
}
function reliesOnIt(fiber: Fiber): number {
  const op = fiber.next(1);
  return op ? op.run(2) : -1;
}
const callers: Array<(f: Fiber) => number> = [
  f => keep(f.next(0)), f => keep(f.next(1)), f => keep(f.next(2)), f => keep(f.next(3)), f => keep(f.next(4)), f => keep(f.next(5)), f => keep(f.next(6)), f => keep(f.next(7)), f => keep(f.next(8)), f => keep(f.next(9)),
  f => keep(f.next(10)), f => keep(f.next(11)), f => keep(f.next(12)), f => keep(f.next(13)), f => keep(f.next(14)), f => keep(f.next(15)), f => keep(f.next(16)), f => keep(f.next(17)), f => keep(f.next(18)), f => keep(f.next(19)),
  f => keep(f.next(20)), f => keep(f.next(21)), f => keep(f.next(22)), f => keep(f.next(23)), f => keep(f.next(24)), f => keep(f.next(25)), f => keep(f.next(26)), f => keep(f.next(27)), f => keep(f.next(28)), f => keep(f.next(29)),
  f => keep(f.next(30)), f => keep(f.next(31)), f => keep(f.next(32)), f => keep(f.next(33)), f => keep(f.next(34)), f => keep(f.next(35)), f => keep(f.next(36)), f => keep(f.next(37)), f => keep(f.next(38)), f => keep(f.next(39)),
  f => keep(f.next(40)), f => keep(f.next(41)), f => keep(f.next(42)), f => keep(f.next(43)), f => keep(f.next(44)), f => keep(f.next(45)), f => keep(f.next(46)), f => keep(f.next(47)), f => keep(f.next(48)), f => keep(f.next(49)),
  f => keep(f.next(50)), f => keep(f.next(51)), f => keep(f.next(52)), f => keep(f.next(53)), f => keep(f.next(54)), f => keep(f.next(55)), f => keep(f.next(56)), f => keep(f.next(57)), f => keep(f.next(58)), f => keep(f.next(59)),
  f => keep(f.next(60)), f => keep(f.next(61)), f => keep(f.next(62)), f => keep(f.next(63)), f => keep(f.next(64)), f => keep(f.next(65)), f => keep(f.next(66)), f => keep(f.next(67)), f => keep(f.next(68)), f => keep(f.next(69)),
  f => keep(f.next(70)), f => keep(f.next(71)), f => keep(f.next(72)), f => keep(f.next(73)), f => keep(f.next(74)), f => keep(f.next(75)), f => keep(f.next(76)), f => keep(f.next(77)), f => keep(f.next(78)), f => keep(f.next(79)),
  f => keep(f.next(80)), f => keep(f.next(81)), f => keep(f.next(82)), f => keep(f.next(83)), f => keep(f.next(84)), f => keep(f.next(85)), f => keep(f.next(86)), f => keep(f.next(87)), f => keep(f.next(88)), f => keep(f.next(89)),
  f => keep(f.next(90)), f => keep(f.next(91)), f => keep(f.next(92)), f => keep(f.next(93)), f => keep(f.next(94)), f => keep(f.next(95)), f => keep(f.next(96)), f => keep(f.next(97)), f => keep(f.next(98)), f => keep(f.next(99)),
  f => keep(f.next(100)), f => keep(f.next(101)), f => keep(f.next(102)), f => keep(f.next(103)), f => keep(f.next(104)), f => keep(f.next(105)), f => keep(f.next(106)), f => keep(f.next(107)), f => keep(f.next(108)), f => keep(f.next(109)),
  f => keep(f.next(110)), f => keep(f.next(111)), f => keep(f.next(112)), f => keep(f.next(113)), f => keep(f.next(114)), f => keep(f.next(115)), f => keep(f.next(116)), f => keep(f.next(117)), f => keep(f.next(118)), f => keep(f.next(119)),
  f => keep(f.next(120)), f => keep(f.next(121)), f => keep(f.next(122)), f => keep(f.next(123)), f => keep(f.next(124)), f => keep(f.next(125)), f => keep(f.next(126)), f => keep(f.next(127)), f => keep(f.next(128)), f => keep(f.next(129)),
  f => keep(f.next(130)), f => keep(f.next(131)), f => keep(f.next(132)), f => keep(f.next(133)), f => keep(f.next(134)), f => keep(f.next(135)), f => keep(f.next(136)), f => keep(f.next(137)), f => keep(f.next(138)), f => keep(f.next(139)),
  f => keep(f.next(140)), f => keep(f.next(141)), f => keep(f.next(142)), f => keep(f.next(143)), f => keep(f.next(144)), f => keep(f.next(145)), f => keep(f.next(146)), f => keep(f.next(147)), f => keep(f.next(148)), f => keep(f.next(149)),
  f => keep(f.next(150)), f => keep(f.next(151)), f => keep(f.next(152)), f => keep(f.next(153)), f => keep(f.next(154)), f => keep(f.next(155)), f => keep(f.next(156)), f => keep(f.next(157)), f => keep(f.next(158)), f => keep(f.next(159)),
];
const fiber = new Fiber();
let calls = 0;
for (let round = 0; round < 50; round++) {
  for (const caller of callers) {
    fiber.stack.push(round % 5 ? other : new Op(round));
    calls += caller(fiber);
  }
  fiber.stack.push(round % 2 ? other : new Op(round));
  sum += reliesOnIt(fiber);
}
console.log(sum, calls);
