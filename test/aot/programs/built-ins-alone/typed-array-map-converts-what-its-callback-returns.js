const mapped = new Uint8Array([1, 2]).map((value, index, view) => (index === 0 ? 257.5 : "3"));
console.log(mapped[0] + 1, mapped[1] + 1, mapped instanceof Uint8Array);
