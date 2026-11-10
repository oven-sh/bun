// @bun
function  odd (a,b){return a+b}
const bare = a=>a, spaced = ( a , b )=>a, later = async a=>a;
class Kept { m (a){return a} static  s ( a ){return a} get  g (){return 1} }
const holder = { n (a){return a}, *made ( a ){yield a} };
const reads = () => { const k = 1; k; return 2; }, self = () => this, dead = function(){ if (false) { odd(); } return typeof undefined; };
const shown = [odd, bare, spaced, later, Kept, Kept.prototype.m, Kept.s, Object.getOwnPropertyDescriptor(Kept.prototype, "g").get, holder.n, holder.made, reads, self, dead];
export { shown };
