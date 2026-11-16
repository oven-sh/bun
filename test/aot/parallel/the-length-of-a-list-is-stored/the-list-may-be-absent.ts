const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
let held: number[] | undefined;
function reset(to: number): string { try { held!.length = to >>> 0; return "stored " + held!.length; } catch (error) { return (error as Error).constructor.name; } }
console.log(reset(numbers[0]!)); held = [1, 2, 3]; console.log(reset(numbers[3]!), reset(numbers[1]!));
