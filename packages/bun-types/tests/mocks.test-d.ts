import { expectType } from "tsd";
import { mock, jest } from "bun:test";

const mock1 = mock((arg: string) => {
  return arg.length;
});

const arg1 = mock1("1");
expectType<number>(arg1);
mock;

type arg2 = jest.Spied<() => string>;
declare var arg2: arg2;
arg2.mock.calls[0];
mock;

type _arg3 = jest.Mock<() => number>;
