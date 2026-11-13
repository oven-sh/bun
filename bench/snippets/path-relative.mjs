import { posix, win32 } from "path";
import { bench, run } from "../runner.mjs";

const pathConfigurations = [
  ["", ""],
  [".", "."],
  ["/foo/bar", "/foo/bar"],
  ["/foo/bar/baz", "/foo/bar"],
  ["/foo/bar", "/foo/bar/baz"],
  ["/foo/bar/baz", "/foo/bar/qux"],
  ["/foo/bar/baz", "/foo/bar/baz/qux"],
  ["/foo/bar/baz", "/foo/bar/baz/qux/quux"],
  ["/", "/foo"],
  ["/foo", "/"],
  ["foo/bar/baz", "foo/bar/qux"],
  ["../foo/bar", "../foo/baz"],
];

pathConfigurations.forEach(([from, to]) => {
  bench(`relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`, () => {
    globalThis.abc = posix.relative(from, to);
  });
});

const longFolder = "C:\\Пользователи\\Иван\\" + "очень-длинное-имя-папки\\".repeat(7);

const win32Configurations = [
  ["C:\\Users\\someone\\project\\src\\components\\button.tsx", "C:\\Users\\someone\\project\\src\\utils\\format.ts"],
  ["C:\\Users\\someone\\project", "C:\\Users\\someone\\project\\node_modules\\react\\index.js"],
  ["c:\\users\\Someone\\Project\\src", "C:\\Users\\someone\\project\\SRC\\index.ts"],
  ["\\\\server\\share\\dir\\a", "\\\\server\\share\\dir\\b\\c"],
  // Letters outside of ASCII in the folders that both paths are in.
  ["C:\\Users\\José\\project\\src\\components\\button.tsx", "C:\\Users\\José\\project\\src\\utils\\format.ts"],
  ["C:\\Users\\Łukasz\\project\\src\\components\\button.tsx", "C:\\Users\\Łukasz\\project\\src\\utils\\format.ts"],
  ["C:\\Users\\Łukasz\\project", "C:\\Users\\Łukasz\\project\\node_modules\\react\\index.js"],
  ["C:\\ユーザー\\太郎\\プロジェクト\\src\\a", "C:\\ユーザー\\太郎\\プロジェクト\\lib\\b"],
  ["\\\\server\\share\\Łukasz\\a", "\\\\server\\share\\Łukasz\\b\\c"],
  [longFolder + "src\\a.ts", longFolder + "lib\\b.ts"],
  // And the drive in another case.
  ["c:\\Users\\Łukasz\\project", "C:\\Users\\Łukasz\\project\\src\\index.ts"],
  ["c:\\Пользователи\\Иван\\проект\\src\\a", "C:\\Пользователи\\Иван\\проект\\lib\\b"],
  ["c:\\ユーザー\\太郎\\プロジェクト\\src\\a", "C:\\ユーザー\\太郎\\プロジェクト\\lib\\b"],
  // In the parts that differ.
  ["C:\\Users\\Łukasz\\Документы\\отчёт.txt", "C:\\Users\\Łukasz\\Загрузки\\файл.txt"],
  ["C:\\Users\\José\\project", "C:\\Program Files\\nodejs\\node.exe"],
  // In another case.
  ["C:\\USERS\\JOSÉ\\project\\src", "C:\\Users\\José\\project\\src\\index.ts"],
  ["C:\\Users\\ŁUKASZ\\project", "C:\\Users\\Łukasz\\project\\src\\index.ts"],
];

win32Configurations.forEach(([from, to]) => {
  bench(`win32.relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`, () => {
    globalThis.abc = win32.relative(from, to);
  });
});

// The same characters, held in 16 bits.
const in16Bits = text => Buffer.from(text, "utf16le").toString("utf16le");

win32Configurations.slice(0, 2).forEach(([from, to]) => {
  const [from16, to16] = [in16Bits(from), in16Bits(to)];
  bench(`win32.relative(${JSON.stringify(from)}, ${JSON.stringify(to)}) in 16 bits`, () => {
    globalThis.abc = win32.relative(from16, to16);
  });
});

await run();
