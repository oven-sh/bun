const list = [1.5, 2.5, 3.5];
class Holder {
  length = 0;
}
const holder = Array.from.call(Holder, list);
console.log(holder instanceof Holder, holder.length, holder[0] + 1, Object.keys(holder).join());
