const other: any = { key: 2 };
const made: any = { key: 1, ...other };
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(made, "key")), Object.keys(made).join(), JSON.stringify(made));
if (Object.keys(made).length > 5) Object.defineProperty(made, "key", { value: 6 });
