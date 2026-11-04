const tools = { first() { return 1; }, get third() { return 3; }, fourth: 4 };
const { fourth, ...rest } = tools; console.log(JSON.stringify(rest), Object.keys(rest).join(), Object.values(rest).length);
