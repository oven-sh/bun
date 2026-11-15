const grouped = Map.groupBy([1, 2, 3], value => value & 1);
const encoded = new TextEncoder().encode("ab");
const bytes = Buffer.from("abcd");
const entries = [1, 2].entries();
const bound = function (this: unknown, left: number, right: number) { return left + right; }.bind(null, 1);
console.log(grouped.get(1)!.join(), grouped.size, encoded.length, encoded.indexOf(98), bytes.readUInt8(1), bytes.toString("hex"), bytes.equals(Buffer.from("abcd")), entries.next().value!.join(), bound(2), bound.name, bound.length);
