const list = [1.5, "two"];
for (const key of list.keys()) console.log(key + 1);
for (const value of list.values()) console.log(typeof value, value);
for (const [key, value] of list.entries()) console.log(key + 1, typeof value);
