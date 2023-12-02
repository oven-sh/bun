import { QUnit } from "qunit";

const { module, test } = QUnit;
const { todo, skip } = test;

const pass = test;
const fail = test;

module("assert.async()", () => {
  pass("1 complete task", assert => {
    const done = assert.async();
    done();
  });
  pass("2 complete tasks", assert => {
    const done1 = assert.async();
    const done2 = assert.async(2);
    done1();
    done2();
    done2();
  });
  fail("1 incomplete task", assert => {
    const done = assert.async(2);
    done();
  });
});

module("assert.deepEqual()", () => {
  pass("equal objects", assert => {
    assert.deepEqual({ a: 1, b: { c: "d" } }, { a: 1, b: { c: "d" } });
    assert.deepEqual([1, 2, "three"], [1, 2, "three"]);
  });
  fail("unequal objects", assert => {
    assert.deepEqual({ a: 1, b: "d" }, { a: 1, b: { c: "d" } });
  });
});

module("assert.equal()", () => {
  pass("equal values", assert => {
    assert.equal(1, 1);
    assert.equal(1, "1");
    assert.equal(0, "");
  });
  fail("unequal values", assert => {
    assert.equal(null, false);
  });
});

module("assert.expect()", () => {
  pass("no assertions", assert => {
    assert.expect(0);
  });
  pass("expected number of assertions", assert => {
    assert.expect(1);
    assert.ok(true);
  });
  fail("unexpected number of assertions", assert => {
    assert.expect(3);
    assert.ok(true);
    assert.ok(true);
  });
});

module("assert.false()", () => {
  pass("false", assert => {
    assert.false(false);
  });
  fail("falsey", assert => {
    assert.false(0);
  });
  fail("true", assert => {
    assert.false(true);
  });
});

module("assert.notDeepEqual()", () => {
  pass("unequal objects", assert => {
    assert.notDeepEqual({ a: 1, b: "d" }, { a: 1, b: { c: "d" } });
  });
  fail("equal objects", assert => {
    assert.notDeepEqual({ a: 1, b: { c: "d" } }, { a: 1, b: { c: "d" } });
  });
});

module("assert.notEqual()", () => {
  pass("unequal values", assert => {
    assert.notEqual(null, false);
  });
  fail("equal values", assert => {
    assert.notEqual(1, 1);
  });
});

module("assert.notOk()", () => {
  pass("false", assert => {
    assert.notOk(false);
  });
  pass("falsey", assert => {
    assert.notOk("");
  });
  fail("truthy", assert => {
    assert.notOk(1);
  });
});

module.todo("assert.notPropContains()");

todo("assert.notPropEqual()");

module("assert.notStrictEqual()", () => {
  pass("unequal values", assert => {
    assert.notStrictEqual(1, "1");
  });
  fail("equal values", assert => {
    assert.notStrictEqual(1, 1);
  });
});

module("assert.ok()", () => {
  pass("true", assert => {
    assert.ok(true);
  });
  pass("truthy", assert => {
    assert.ok(1);
  });
  fail("false", assert => {
    assert.ok(false);
  });
  fail("falsey", assert => {
    assert.ok("");
  });
});

module.todo("assert.propContains()");

module.todo("assert.propEqual()");

module.todo("assert.pushResult()");

module("assert.rejects()", () => {
  skip("rejected promise", assert => {
    assert.rejects(Promise.reject()); // segfault?
  });
  pass("rejected promise", assert => {
    assert.rejects(Promise.reject(new Error("foo")), new Error("foo"));
    assert.rejects(Promise.reject(new TypeError("foo")), TypeError);
    assert.rejects(Promise.reject(new Error("foo")), "foo");
    assert.rejects(Promise.reject(new Error("foo")), /foo/);
  });
  fail("resolved promise", assert => {
    assert.rejects(Promise.resolve());
  });
  fail("rejected promise with unexpected error", assert => {
    assert.rejects(Promise.reject(new Error("foo")), "bar");
  });
});

module("assert.step()", () => {
  pass("correct steps", assert => {
    assert.step("foo");
    assert.step("bar");
    assert.verifySteps(["foo", "bar"]);
  });
  fail("incorrect steps", assert => {
    assert.step("foo");
    assert.verifySteps(["bar"]);
  });
});

module("assert.strictEqual()", () => {
  pass("equal values", assert => {
    assert.strictEqual(1, 1);
  });
  fail("unequal values", assert => {
    assert.strictEqual(1, "1");
  });
});

module("assert.throws()", () => {
  pass("thrown error", assert => {
    assert.throws(() => {
      throw new Error("foo");
    }, new Error("foo"));
    assert.throws(() => {
      throw new TypeError("foo");
    }, TypeError);
    assert.throws(() => {
      throw new Error("foo");
    }, "foo");
    assert.throws(() => {
      throw new Error("foo");
    }, /foo/);
  });
  fail("no error thrown", assert => {
    assert.throws(() => {});
  });
  fail("unexpected error thrown", assert => {
    assert.throws(() => {
      throw new Error("foo");
    }, "bar");
  });
});

module("assert.timeout()", () => {
  pass("no timeout", assert => {
    assert.timeout(0);
  });
  fail("early timeout", assert => {
    const done = assert.async();
    assert.timeout(1);
    setTimeout(done, 2);
  });
});

module("assert.true()", () => {
  pass("true", assert => {
    assert.true(true);
  });
  fail("truthy", assert => {
    assert.true(1);
  });
  fail("false", assert => {
    assert.true(false);
  });
});

module("assert.verifySteps()", () => {
  pass("correct steps", assert => {
    assert.step("foo");
    assert.verifySteps(["foo"]);
    assert.step("bar");
    assert.verifySteps(["bar"]);
    assert.verifySteps([]);
  });
  fail("incorrect steps", assert => {
    assert.step("foo");
    assert.verifySteps(["foo", "bar"]);
    assert.step("bar");
  });
});
