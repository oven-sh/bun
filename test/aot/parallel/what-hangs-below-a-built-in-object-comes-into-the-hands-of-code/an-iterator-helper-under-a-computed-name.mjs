const step = ["ma", "p"].join("");
console.log([...[1, 2].values()[step](x => x * 2)].join());
