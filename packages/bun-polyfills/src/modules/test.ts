import _dateFormat from 'dateformat';
const dateFormat = _dateFormat as unknown as typeof import('dateformat').default; // 10/10 types :D
import { expect as jestexpect } from 'expect';
import _jesteach from 'jest-each';
import extendedMatchers from 'jest-extended';
const jesteach = _jesteach.default as unknown as typeof import('jest-each').default; // bad types, again...
import * as jestmock from 'jest-mock';
import nodetest from 'node:test';
import chp from 'node:child_process';
import { promisify } from 'node:util';
import type { Mock } from 'bun:test';
const exec = promisify(chp.exec);

const bunmock: typeof import('bun:test')['mock'] = function mock(fn) {
    return jestmock.fn(fn);
};
bunmock.module = (id, factory) => { }; // TODO: Need to integrate this with the ESM loader somehow.
bunmock.restore = () => { }; // TODO

const bundescribe: typeof import('bun:test')['describe'] = (name, fn) => nodetest.describe(name, fn);
bundescribe.only = (name, fn) => nodetest.describe.only(name, fn);
bundescribe.todo = (name, fn) => nodetest.describe.todo(name, fn);
bundescribe.skip = (name, fn) => nodetest.describe.skip(name, fn);
bundescribe.skipIf = (condition) => condition ? nodetest.describe.skip : nodetest.describe;
bundescribe.if = (condition) => condition ? nodetest.describe : () => void 0;
bundescribe.each = (table: any) => {
    return (title: string, suite: AnyFunction) => jesteach(table).describe(title, suite);
};

jestexpect.extend(extendedMatchers);
const bunExpect = jestexpect as unknown as typeof import('bun:test')['expect'];
bunExpect.unreachable = (msg) => {
    if (msg instanceof Error) throw msg;
    else throw new Error(msg ?? 'Unreachable code reached');
};

const bunit: typeof import('bun:test')['it'] = (name, fn) => {
    nodetest.it(name, fn.length ? async (t, done) => void await fn(done) : async (t) => void await (fn as () => Promise<void>)());
};
bunit.only = (name, fn) => nodetest.only(name, fn.length ? async (t, done) => void await fn(done) : async (t) => void await (fn as () => Promise<void>)());
bunit.todo = (name, fn) => nodetest.todo(name, fn?.length ? async (t, done) => void await fn?.(done) : async (t) => void await (fn as () => Promise<void>)());
bunit.skip = (name, fn) => nodetest.skip(name, fn.length ? async (t, done) => void await fn(done) : async (t) => void await (fn as () => Promise<void>)());
bunit.if = (condition) => condition ? bunit : () => void 0;
bunit.skipIf = (condition) => condition ? bunit.skip : bunit;
bunit.each = (table: any) => {
    return (title: string, test: AnyFunction) => jesteach(table).it(title, test);
};

const testModule = {
    // This entire function is overall very hacky and little tested for now.
    // Maybe it would be better to just monkeypatch the relevant JS apis instead?
    setSystemTime(now?: Date | number) {
        if (process.platform === 'linux') {
            const sudo = ''; // process.getuid?.() === 0 ? '' : 'sudo ';
            if (typeof now === 'undefined') {
                exec(`${sudo}timedatectl set-ntp true`);
                return this;
            }
            //? Doesn't work on non-systemd distros, nor WSL by default...
            exec(
                `${sudo}timedatectl set-ntp false && ` +
                `${sudo}date -s "${dateFormat(now, "UTC:mm/dd/yyyy HH:MM:ss")}" --utc && ` +
                `${sudo}hwclock -w --utc`
            );
        } else if (process.platform === 'win32') {
            const Win32DateFormat = (() => {
                try {
                    const stdout = chp.execSync('date');
                    return stdout.toString('utf8').match(/Enter the new date: \((.+)\)/)?.[1] ?? 'dd-mm-yy';
                } catch (e) {
                    const err = e as { stdout: Buffer; };
                    return err.stdout.toString('utf8').match(/Enter the new date: \((.+)\)/)?.[1] ?? 'dd-mm-yy';
                }
            })();
            if (typeof now === 'undefined') {
                // TODO: How to reset system time on Windows? Below might work but is messy and needs admin...
                /* net stop w32time
                   w32tm /unregister
                   w32tm /register
                   net start w32time
                   w32tm /resync */
                return this;
            }
            exec(
                `date ${dateFormat(now, Win32DateFormat)} && ` +
                `time ${dateFormat(now, "HH:MM:ss")}`
            );
        } else throw new Error(`Unsupported platform for setSystemTime: ${process.platform}`); // TODO: How to set system time on MacOS? Can't test for now :(
        return this;
    },
    spyOn<T extends object, K extends keyof T>(obj: T, methodOrPropertyValue: K): Mock<T[K] extends AnyFunction ? T[K] : never> {
        const mock = jestmock.spyOn(
            obj,
            // @ts-expect-error jest has a really convoluted type for this that isnt worth trying to replicate
            methodOrPropertyValue,
        ) as jestmock.Spied<any>;
        // @ts-expect-error same reason as above
        return mock;
    },
    beforeAll(fn) {
        nodetest.before(fn.length ? (s, done) => void fn(done) : (s) => void (fn as () => void)());
    },
    beforeEach(fn) {
        nodetest.beforeEach(fn.length ? (s, done) => void fn(done) : (s) => void (fn as () => void)());
    },
    afterAll(fn) {
        nodetest.after(fn.length ? (s, done) => void fn(done) : (s) => void (fn as () => void)());
    },
    afterEach(fn) {
        nodetest.afterEach(fn.length ? (s, done) => void fn(done) : (s) => void (fn as () => void)());
    },
    mock: bunmock,
    jest: {
        restoreAllMocks() {
            bunmock.restore();
        },
        fn(func) {
            return jestmock.fn(func);
        },
    },
    describe: bundescribe,
    test: bunit,
    it: bunit,
    expect: bunExpect, // TODO: this is not fully compatible, needs finer grained implementation
} satisfies typeof import('bun:test');

export const setSystemTime = testModule.setSystemTime;
export const spyOn = testModule.spyOn;
export const beforeAll = testModule.beforeAll;
export const beforeEach = testModule.beforeEach;
export const afterAll = testModule.afterAll;
export const afterEach = testModule.afterEach;
export const mock = testModule.mock;
export const jest = testModule.jest;
export const describe = testModule.describe;
export const test = testModule.test;
export const it = testModule.it;
export const expect = testModule.expect;
export default testModule;
