const data = JSON.parse('{ "first": 1.5, "list": ["two", null, { "three": 3 }], "none": null }');
console.log(data.first + 1, data.list.length, data.list[0].length, data.list[1] === null, data.list[2].three + 1, data.none === null, data.missing === undefined);
