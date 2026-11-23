let made: any;
(made as any) ??= class {};
console.log(JSON.stringify(made.name));
