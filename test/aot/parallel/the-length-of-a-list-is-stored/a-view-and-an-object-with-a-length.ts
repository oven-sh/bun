const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function storeOnView(view: Float64Array, to: number): string { try { (view as any).length = to >>> 0; return "stored " + view.length; } catch (error) { return (error as Error).constructor.name + " " + view.length; } }
function storeOnObject(object: { length: number }, to: number): number { object.length = to >>> 0; return object.length; }
function storeOnEither(either: number[] | { length: number }, to: number): number { either.length = to >>> 0; return either.length; }
console.log(storeOnView(new Float64Array(4), numbers[2]!), storeOnObject({ length: 9 }, numbers[2]!), storeOnEither([1, 2, 3], numbers[1]!), storeOnEither({ length: 3 }, numbers[1]!));
function storeOnText(text: string, to: number): string { try { (text as any).length = to >>> 0; return "stored"; } catch (error) { return (error as Error).constructor.name; } }
console.log(storeOnText("abc", numbers[1]!));
