export const Maker = function Maker(n) { this.made = n; this.twice = n * 2; };
const Hidden = function Hidden(n) { this.hidden = n; };
export { Hidden as Shown };
const Default = function Default(n) { this.byDefault = n; };
export default Default;
const Local = function Local(n) { this.local = n; };
export const makeLocal = n => new Local(n);
const listener = function listener(n) { this.heard = n; };
export const hear = (target, n) => { listener.call(target, n); return target; };
