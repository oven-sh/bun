const made = Object.fromEntries([["first", 1.5], ["second", "two"]]);
console.log(made.first + 1, made.second.length, Object.keys(made).join(), JSON.stringify(made));
