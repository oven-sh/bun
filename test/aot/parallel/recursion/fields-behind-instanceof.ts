// Fields stored behind instanceof, in the arm, in a callee, through an alias, by a setter, under a computed name, in a handler, in recursion and in a loop, and read behind the join. Some objects have lost the field or hold what it was not written for.
declare const missing: (value: any, other: any) => string;
const printed: string[] = [];
function say(text: string): void { printed.push(text); if (printed.length === 12) console.log(printed.splice(0).join(" ")); }
class LeafArm {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafArm"; this.size = value; this.weight = value + 0.5; earlyArm(this); }
}
class TwigArm {}
class BranchArm { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlyArmCount = 0;
function earlyArm(value: any): void { if (earlyArmCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeArm(value: LeafArm | TwigArm | BranchArm | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafArm).size;
  if (other instanceof LeafArm) { (other as any).size = 2.5; }
  text += JSON.stringify((value as LeafArm).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafArm).size; } else { text += "-"; }
  return text;
}
const anotherArm: any = new LeafArm(5);
anotherArm.weight = "another";
const deletedArm: any = new LeafArm(6);
delete deletedArm.size;
const allArm: (LeafArm | TwigArm | BranchArm | bigint | number)[] = [new LeafArm(1), new TwigArm(), new BranchArm(), anotherArm, deletedArm, 5n, 2.5, new LeafArm(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allArm.length; index++) {
    try { say(describeArm(allArm[index]!, allArm[(index + 1) % allArm.length])); } catch (error) { say((error as Error).name); }
  }
}
class LeafCallee {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafCallee"; this.size = value; this.weight = value + 0.5; earlyCallee(this); }
}
class TwigCallee {}
class BranchCallee { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
function putCallee(value: any, stored: number): void { value.size = stored; }
let earlyCalleeCount = 0;
function earlyCallee(value: any): void { if (earlyCalleeCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeCallee(value: LeafCallee | TwigCallee | BranchCallee | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafCallee).size;
  if (other instanceof LeafCallee) { putCallee(other, 2.5); }
  text += JSON.stringify((value as LeafCallee).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafCallee).size; } else { text += "-"; }
  return text;
}
const anotherCallee: any = new LeafCallee(5);
anotherCallee.weight = "another";
const deletedCallee: any = new LeafCallee(6);
delete deletedCallee.size;
const allCallee: (LeafCallee | TwigCallee | BranchCallee | bigint | number)[] = [new LeafCallee(1), new TwigCallee(), new BranchCallee(), anotherCallee, deletedCallee, 5n, 2.5, new LeafCallee(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allCallee.length; index++) {
    try { say(describeCallee(allCallee[index]!, allCallee[(index + 1) % allCallee.length])); } catch (error) { say((error as Error).name); }
  }
}
class LeafAlias {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafAlias"; this.size = value; this.weight = value + 0.5; earlyAlias(this); }
}
class TwigAlias {}
class BranchAlias { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlyAliasCount = 0;
function earlyAlias(value: any): void { if (earlyAliasCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeAlias(value: LeafAlias | TwigAlias | BranchAlias | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafAlias).size;
  if (other instanceof LeafAlias) { const held: any = other; const again: any = held; again.size = 2.5; }
  text += JSON.stringify((value as LeafAlias).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafAlias).size; } else { text += "-"; }
  return text;
}
const anotherAlias: any = new LeafAlias(5);
anotherAlias.weight = "another";
const deletedAlias: any = new LeafAlias(6);
delete deletedAlias.size;
const allAlias: (LeafAlias | TwigAlias | BranchAlias | bigint | number)[] = [new LeafAlias(1), new TwigAlias(), new BranchAlias(), anotherAlias, deletedAlias, 5n, 2.5, new LeafAlias(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allAlias.length; index++) {
    try { say(describeAlias(allAlias[index]!, allAlias[(index + 1) % allAlias.length])); } catch (error) { say((error as Error).name); }
  }
}
class LeafSetter {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafSetter"; this.size = value; this.weight = value + 0.5; earlySetter(this); }
  set through(value: any) { this.size = value; }
}
class TwigSetter {}
class BranchSetter { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlySetterCount = 0;
function earlySetter(value: any): void { if (earlySetterCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeSetter(value: LeafSetter | TwigSetter | BranchSetter | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafSetter).size;
  if (other instanceof LeafSetter) { (other as any).through = 2.5; }
  text += JSON.stringify((value as LeafSetter).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafSetter).size; } else { text += "-"; }
  return text;
}
const anotherSetter: any = new LeafSetter(5);
anotherSetter.weight = "another";
const deletedSetter: any = new LeafSetter(6);
delete deletedSetter.size;
const allSetter: (LeafSetter | TwigSetter | BranchSetter | bigint | number)[] = [new LeafSetter(1), new TwigSetter(), new BranchSetter(), anotherSetter, deletedSetter, 5n, 2.5, new LeafSetter(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allSetter.length; index++) {
    try { say(describeSetter(allSetter[index]!, allSetter[(index + 1) % allSetter.length])); } catch (error) { say((error as Error).name); }
  }
}
class LeafName {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafName"; this.size = value; this.weight = value + 0.5; earlyName(this); }
}
class TwigName {}
class BranchName { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlyNameCount = 0;
function earlyName(value: any): void { if (earlyNameCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeName(value: LeafName | TwigName | BranchName | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafName).size;
  if (other instanceof LeafName) { (other as any)["si" + "ze"] = 2.5; }
  text += JSON.stringify((value as LeafName).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafName).size; } else { text += "-"; }
  return text;
}
const anotherName: any = new LeafName(5);
anotherName.weight = "another";
const deletedName: any = new LeafName(6);
delete deletedName.size;
const allName: (LeafName | TwigName | BranchName | bigint | number)[] = [new LeafName(1), new TwigName(), new BranchName(), anotherName, deletedName, 5n, 2.5, new LeafName(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allName.length; index++) {
    try { say(describeName(allName[index]!, allName[(index + 1) % allName.length])); } catch (error) { say((error as Error).name); }
  }
}
class LeafHandler {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafHandler"; this.size = value; this.weight = value + 0.5; earlyHandler(this); }
}
class TwigHandler {}
class BranchHandler { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlyHandlerCount = 0;
function earlyHandler(value: any): void { if (earlyHandlerCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeHandler(value: LeafHandler | TwigHandler | BranchHandler | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafHandler).size;
  try { if (other instanceof LeafHandler) { (other as any).size = 2.5; if ((other as any).weight === "another") throw new Error("thrown"); } } catch (error) { text += (error as Error).message + JSON.stringify((value as LeafHandler).size); }
  text += JSON.stringify((value as LeafHandler).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafHandler).size; } else { text += "-"; }
  return text;
}
const anotherHandler: any = new LeafHandler(5);
anotherHandler.weight = "another";
const deletedHandler: any = new LeafHandler(6);
delete deletedHandler.size;
const allHandler: (LeafHandler | TwigHandler | BranchHandler | bigint | number)[] = [new LeafHandler(1), new TwigHandler(), new BranchHandler(), anotherHandler, deletedHandler, 5n, 2.5, new LeafHandler(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allHandler.length; index++) {
    try { say(describeHandler(allHandler[index]!, allHandler[(index + 1) % allHandler.length])); } catch (error) { say((error as Error).name); }
  }
}
class LeafRecursion {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafRecursion"; this.size = value; this.weight = value + 0.5; earlyRecursion(this); }
}
class TwigRecursion {}
class BranchRecursion { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlyRecursionCount = 0;
function earlyRecursion(value: any): void { if (earlyRecursionCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeRecursion(value: LeafRecursion | TwigRecursion | BranchRecursion | bigint | number, other: any, depth: number): any {
  let text: any = "/" + (value as LeafRecursion).size;
  if (other instanceof LeafRecursion) { (other as any).size = 2.5; }
  if (depth > 0) text += describeRecursion(other, value, depth - 1);
  text += JSON.stringify((value as LeafRecursion).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafRecursion).size; } else { text += "-"; }
  return text;
}
const anotherRecursion: any = new LeafRecursion(5);
anotherRecursion.weight = "another";
const deletedRecursion: any = new LeafRecursion(6);
delete deletedRecursion.size;
const allRecursion: (LeafRecursion | TwigRecursion | BranchRecursion | bigint | number)[] = [new LeafRecursion(1), new TwigRecursion(), new BranchRecursion(), anotherRecursion, deletedRecursion, 5n, 2.5, new LeafRecursion(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allRecursion.length; index++) {
    try { say(describeRecursion(allRecursion[index]!, allRecursion[(index + 1) % allRecursion.length], 2)); } catch (error) { say((error as Error).name); }
  }
}
class LeafLoop {
  kind: string; size: number; weight: any;
  constructor(value: number) { this.kind = "LeafLoop"; this.size = value; this.weight = value + 0.5; earlyLoop(this); }
}
class TwigLoop {}
class BranchLoop { kind: string; lid: any; constructor() { this.kind = "Branch"; this.lid = undefined; } }
let earlyLoopCount = 0;
function earlyLoop(value: any): void { if (earlyLoopCount++ > 8) return; try { say("early" + missing(value, value)); } catch (error) { say((error as Error).name); } }
function describeLoop(value: LeafLoop | TwigLoop | BranchLoop | bigint | number, other: any): any {
  let text: any = "/" + (value as LeafLoop).size;
  for (let index = 0; index < 3; index++) { if (other instanceof LeafLoop) { (other as any).size = index + 0.5; } text += JSON.stringify((value as LeafLoop).size); }
  text += JSON.stringify((value as LeafLoop).size);
  if (typeof value !== "bigint") { text += "/" + (value as LeafLoop).size; } else { text += "-"; }
  return text;
}
const anotherLoop: any = new LeafLoop(5);
anotherLoop.weight = "another";
const deletedLoop: any = new LeafLoop(6);
delete deletedLoop.size;
const allLoop: (LeafLoop | TwigLoop | BranchLoop | bigint | number)[] = [new LeafLoop(1), new TwigLoop(), new BranchLoop(), anotherLoop, deletedLoop, 5n, 2.5, new LeafLoop(8)];
for (let round = 0; round < 2; round++) {
  for (let index = 0; index < allLoop.length; index++) {
    try { say(describeLoop(allLoop[index]!, allLoop[(index + 1) % allLoop.length])); } catch (error) { say((error as Error).name); }
  }
}
console.log(printed.join(" "));
export {};
