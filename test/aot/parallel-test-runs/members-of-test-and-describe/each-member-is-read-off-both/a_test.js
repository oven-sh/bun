import { test, describe, expect } from "bun:test";
const seen = [];
try { seen.push("describe.afterAll " + typeof describe.afterAll); } catch (error) { seen.push("describe.afterAll throws " + error.message); }
try { seen.push("test.afterAll " + typeof test.afterAll); } catch (error) { seen.push("test.afterAll throws " + error.message); }
try { seen.push("describe.afterEach " + typeof describe.afterEach); } catch (error) { seen.push("describe.afterEach throws " + error.message); }
try { seen.push("test.afterEach " + typeof test.afterEach); } catch (error) { seen.push("test.afterEach throws " + error.message); }
try { seen.push("describe.aroundAll " + typeof describe.aroundAll); } catch (error) { seen.push("describe.aroundAll throws " + error.message); }
try { seen.push("test.aroundAll " + typeof test.aroundAll); } catch (error) { seen.push("test.aroundAll throws " + error.message); }
try { seen.push("describe.aroundEach " + typeof describe.aroundEach); } catch (error) { seen.push("describe.aroundEach throws " + error.message); }
try { seen.push("test.aroundEach " + typeof test.aroundEach); } catch (error) { seen.push("test.aroundEach throws " + error.message); }
try { seen.push("describe.beforeAll " + typeof describe.beforeAll); } catch (error) { seen.push("describe.beforeAll throws " + error.message); }
try { seen.push("test.beforeAll " + typeof test.beforeAll); } catch (error) { seen.push("test.beforeAll throws " + error.message); }
try { seen.push("describe.beforeEach " + typeof describe.beforeEach); } catch (error) { seen.push("describe.beforeEach throws " + error.message); }
try { seen.push("test.beforeEach " + typeof test.beforeEach); } catch (error) { seen.push("test.beforeEach throws " + error.message); }
try { seen.push("describe.concurrent " + typeof describe.concurrent); } catch (error) { seen.push("describe.concurrent throws " + error.message); }
try { seen.push("test.concurrent " + typeof test.concurrent); } catch (error) { seen.push("test.concurrent throws " + error.message); }
try { seen.push("describe.describe " + typeof describe.describe); } catch (error) { seen.push("describe.describe throws " + error.message); }
try { seen.push("test.describe " + typeof test.describe); } catch (error) { seen.push("test.describe throws " + error.message); }
try { seen.push("describe.failing " + typeof describe.failing); } catch (error) { seen.push("describe.failing throws " + error.message); }
try { seen.push("test.failing " + typeof test.failing); } catch (error) { seen.push("test.failing throws " + error.message); }
try { seen.push("describe.fails " + typeof describe.fails); } catch (error) { seen.push("describe.fails throws " + error.message); }
try { seen.push("test.fails " + typeof test.fails); } catch (error) { seen.push("test.fails throws " + error.message); }
try { seen.push("describe.only " + typeof describe.only); } catch (error) { seen.push("describe.only throws " + error.message); }
try { seen.push("test.only " + typeof test.only); } catch (error) { seen.push("test.only throws " + error.message); }
try { seen.push("describe.sequential " + typeof describe.sequential); } catch (error) { seen.push("describe.sequential throws " + error.message); }
try { seen.push("test.sequential " + typeof test.sequential); } catch (error) { seen.push("test.sequential throws " + error.message); }
try { seen.push("describe.serial " + typeof describe.serial); } catch (error) { seen.push("describe.serial throws " + error.message); }
try { seen.push("test.serial " + typeof test.serial); } catch (error) { seen.push("test.serial throws " + error.message); }
try { seen.push("describe.shuffle " + typeof describe.shuffle); } catch (error) { seen.push("describe.shuffle throws " + error.message); }
try { seen.push("test.shuffle " + typeof test.shuffle); } catch (error) { seen.push("test.shuffle throws " + error.message); }
try { seen.push("describe.skip " + typeof describe.skip); } catch (error) { seen.push("describe.skip throws " + error.message); }
try { seen.push("test.skip " + typeof test.skip); } catch (error) { seen.push("test.skip throws " + error.message); }
try { seen.push("describe.suite " + typeof describe.suite); } catch (error) { seen.push("describe.suite throws " + error.message); }
try { seen.push("test.suite " + typeof test.suite); } catch (error) { seen.push("test.suite throws " + error.message); }
try { seen.push("describe.todo " + typeof describe.todo); } catch (error) { seen.push("describe.todo throws " + error.message); }
try { seen.push("test.todo " + typeof test.todo); } catch (error) { seen.push("test.todo throws " + error.message); }
test("the hooks, describe and suite are members of test alone, and shuffle of describe alone", () => {
  console.log(seen.join("\n"));
  expect(seen.filter(line => line.endsWith(" undefined")).sort()).toEqual([
    "describe.afterAll undefined",
    "describe.afterEach undefined",
    "describe.aroundAll undefined",
    "describe.aroundEach undefined",
    "describe.beforeAll undefined",
    "describe.beforeEach undefined",
    "describe.describe undefined",
    "describe.suite undefined",
    "test.shuffle undefined",
  ]);
});
