let made: any;
({ part: (made as any) = function () {} } = {} as any);
console.log(JSON.stringify(made.name));
