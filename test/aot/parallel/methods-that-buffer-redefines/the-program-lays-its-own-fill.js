class Padded extends Uint8Array {
  fill(value) { return super.fill(value + 1); }
  indexOf(value) { return -7; }
}
function fillWith(view, value) { return view.fill(value); }
console.log(new Padded(3).fill(1).join(), new Padded(3).indexOf(0), new Padded(3).slice(1) instanceof Padded);
const own = new Uint8Array(3);
own.fill = function (value) { return "own " + value; };
own.indexOf = () => "mine";
console.log(own.fill(2), own.join(), own.indexOf(0));
console.log(fillWith(new Uint8Array(2), 4).join(), fillWith(new Padded(2), 4).join(), fillWith(own, 4), fillWith(new Float64Array(2), 1.5).join());
