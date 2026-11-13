process.stdout.mark = 1;
console.log(process.stdout.mark);
delete process.stdout.mark;
console.log(process.stdout.mark, process.stdout.writable);
