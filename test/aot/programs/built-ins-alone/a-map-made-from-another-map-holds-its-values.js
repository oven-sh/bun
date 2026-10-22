const copy = new Map(new Map([["small", 1.5], ["large", "huge"]]));
console.log(copy.size, copy.get("small") + 1, copy.get("large").length);
