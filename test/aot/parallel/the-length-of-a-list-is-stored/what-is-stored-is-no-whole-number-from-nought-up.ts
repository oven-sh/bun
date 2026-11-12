const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function store(list: number[], to: any): string { try { list.length = to; return "stored " + list.length; } catch (error) { return (error as Error).constructor.name + " " + list.length; } }
function storeNumber(list: number[], to: number): string { try { list.length = to; return "stored " + list.length; } catch (error) { return (error as Error).constructor.name + " " + list.length; } }
function storeInt32(list: number[], to: number): string { try { list.length = to | 0; return "stored " + list.length; } catch (error) { return (error as Error).constructor.name + " " + list.length; } }
function storeUint32(list: number[], to: number): string { try { list.length = to >>> 0; return "stored " + list.length; } catch (error) { return (error as Error).constructor.name + " " + list.length; } }
const odd: any[] = JSON.parse('[1.5,-1,"2",null,true,4294967296,4294967295,"x",[1],{}]');
console.log(odd.map(to => store([1, 2, 3], to)).join(" | "));
console.log(storeNumber([1, 2, 3], odd[0]), storeNumber([1, 2, 3], odd[1]), storeNumber([1, 2, 3], odd[5]), storeNumber([1, 2, 3], -0), storeNumber([1, 2, 3], NaN));
console.log(storeInt32([1, 2, 3], odd[1]), storeInt32([1, 2, 3], numbers[2]!), storeUint32([1, 2, 3], odd[1]), storeUint32([1, 2, 3], odd[6]), storeUint32([1, 2, 3], numbers[1]!));
console.log(store([1, 2, 3], { valueOf() { console.log("asked"); return 1; } }));
