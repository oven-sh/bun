const data = await Response.json({ first: 1.5, list: ["two"] }).json();
console.log(data.first + 1, data.list[0].length, data.missing === undefined);
