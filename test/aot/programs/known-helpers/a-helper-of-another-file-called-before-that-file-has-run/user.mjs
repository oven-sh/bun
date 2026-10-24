import { __classPrivateFieldIn } from "./helpers.mjs";
class C {}
try {
    console.log(__classPrivateFieldIn(C, {}));
} catch (error) {
    console.log(error.constructor.name);
}
