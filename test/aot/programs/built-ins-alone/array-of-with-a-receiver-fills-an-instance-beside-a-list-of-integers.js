const list = [1, 2, 3];
class Holder {
  length = 0;
}
const holder = Array.of.call(Holder, list[0], "text");
console.log(holder instanceof Holder, holder.length, holder[0] + 1, holder[1].length);
