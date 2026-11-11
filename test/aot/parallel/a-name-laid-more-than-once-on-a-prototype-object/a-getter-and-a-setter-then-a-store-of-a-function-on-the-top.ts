let heard = 0;
function show(answer: any): string { return typeof answer === "function" ? "function" : String(answer); }
function Top(this: any) { this.size = 1; }
Top.prototype.tell = function () { return 1; };
function Mid(this: any) { Top.call(this); this.more = 2; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
function Low(this: any) { Mid.call(this); }
Object.setPrototypeOf(Low.prototype, Mid.prototype);
const top: any = new (Top as any)();
const mid: any = new (Mid as any)();
const low: any = new (Low as any)();
function ask(who: any): any { return JSON.stringify(who); }
function say(when: string) { try { console.log(when, [show(ask(top)), show(ask(mid)), show(ask(low))].join("|"), heard); } catch (error) { console.log(when, (error as any).name); } }
say("before");
try { for (let turn = 0; turn < 3; turn++) { if (turn === 1) { Object.defineProperty((Top.prototype as any), "tell", { get() { return 7; }, set(v: any) { heard += 1; }, configurable: true }); } } } catch (error) { heard += 10; }
say("between");
try { for (let turn = 0; turn < 3; turn++) { if (turn === 1) { (Top.prototype as any).tell = function (this: any) { return this.size; }; } } } catch (error) { heard += 10; }
say("behind");
export {};
