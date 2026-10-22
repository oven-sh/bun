console.log([...[1.5].values().flatMap(value => new Set([value, "two"]))].length);
