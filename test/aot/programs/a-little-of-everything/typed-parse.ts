// JSON.parse<T>: the text is parsed by code compiled for T, and what that code gives up on goes to the validating helpers of the library.
interface Address { city: string; zip?: string }
interface User { id: number; name: string; tags: string[]; address: Address | null; active: boolean }

const text = '{"id":7,"name":"Ada","tags":["a","b"],"address":{"city":"London"},"active":true}';
const user = JSON.parse<User>(text);
console.log(user.id + 1, user.name.length, user.tags.join("+"), user.address?.city, user.address?.zip, user.active);

const users = JSON.parse<User[]>("[" + text + "," + text.replace("7", "8").replace('{"city":"London"}', "null") + "]");
let sum = 0;
for (const each of users)
    sum += each.id;
console.log(users.length, sum, users[1].address);

// With white space, escapes and members in another order the compiled parser may give up: the answer is the same.
const spaced = JSON.parse<User>(' {\n "active" : false , "tags" : [ ] , "name" : "A\\u0064a\\n" , "id" : 1e1 , "address" : { "zip" : "N1" , "city" : "Y" } , "extra" : [1, {"x": null}] } ');
console.log(spaced.id, JSON.stringify(spaced.name), spaced.tags.length, spaced.address?.zip, spaced.active);

function tryParse(source: string): string {
    try {
        const parsed = JSON.parse<User>(source);
        return "parsed " + typeof parsed;
    } catch (error) {
        return (error as Error).constructor.name;
    }
}
console.log(tryParse("{"), tryParse(text));
console.log(JSON.parse<number>("42") + 1, JSON.parse<string[]>('["x","y"]').length, JSON.parse<boolean | null>("null"));

// Text that does not hold what the type says: the compiled parser gives up and the helper of the library looks at the value. A compiled program refuses it with a TypeError,
// plain Bun erases the type and takes it. Both go on from here, so both print the same.
let outcome = "";
try {
    outcome = typeof JSON.parse<User>('{"id":"seven","tags":7}');
} catch (error) {
    outcome = error instanceof TypeError ? "object" : "another error";
}
console.log(outcome);
// The key is spelled with an escape, which is the same key.
console.log(JSON.parse<Address>('{"c\\u0069ty":"Rome"}').city);
