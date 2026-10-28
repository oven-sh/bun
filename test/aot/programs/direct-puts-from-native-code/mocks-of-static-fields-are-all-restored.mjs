// mock.restore() and jest.restoreAllMocks() put the static fields and methods of a class back.
import { spyOn, mock, jest } from "bun:test";
class A { static a = 1; static f = () => "original"; static g() { return "g"; } static b = 2; static read() { return [A.f(), A.g(), A.a + A.b]; } }
const s1 = spyOn(A, "f").mockReturnValue("mocked f"), s2 = spyOn(A, "g").mockReturnValue("mocked g");
const during = A.read();
mock.restore();
console.log(JSON.stringify([during, A.read(), Object.keys(A), Reflect.ownKeys(A)]));
spyOn(A, "a");
A.a = 10;
const d = Object.getOwnPropertyDescriptor(A, "a");
jest.restoreAllMocks();
console.log(JSON.stringify([typeof d.get, A.read(), Object.keys(A), JSON.stringify(Object.getOwnPropertyDescriptor(A, "a"))]));
