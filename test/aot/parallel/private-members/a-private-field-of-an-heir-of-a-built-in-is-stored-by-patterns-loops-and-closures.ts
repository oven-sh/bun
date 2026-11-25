// Every way in which the language stores under a private name, on an instance of a class below Map: each must be a store that Link follows, or the type of a closed read would be a false proof.
class Odd extends Map<string, number> {
  #v: any = 0; #w: any = 0;
  byPattern() { [this.#v, this.#w] = ["text", { k: 1 }]; }
  byObjectPattern() { ({ a: this.#v, b: this.#w = 7n } = { a: null } as any); }
  byLogic() { this.#v ??= "filled"; this.#w &&= false; this.#w ||= Symbol.for("s"); }
  byLoop() { for (this.#v of [1, "last"]); for (this.#w in { key: 1 }); }
  byClosure() { const put = (v: any) => { this.#v = v; }; put([1]); (() => { this.#w = () => 1; })(); }
  byUpdate() { this.#v = 1; this.#v++; this.#w = 1n; this.#w++; }
  say() { return typeof this.#v + "," + typeof this.#w + " "; }
  static { const first = new Odd(); first.#v = "static block"; }
}
const odd = new Odd(); let out = "";
for (let turn = 0; turn < 100; turn++) { out = odd.say(); odd.byPattern(); out += odd.say(); odd.byObjectPattern(); out += odd.say(); odd.byLogic(); out += odd.say(); odd.byLoop(); out += odd.say(); odd.byClosure(); out += odd.say(); odd.byUpdate(); out += odd.say(); }
console.log(out);
