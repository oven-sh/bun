describe("throw in describe scope doesn't enqueue tests after thrown", () => {
  it("test enqueued before a describe scope throws is never run", () => {
    throw new Error("This test failed");
  });

  throw new Error("This error causes the it below to not be queued");

  it("test enqueued after a describe scope throws is never run", () => {
    throw new Error("This test failed");
  });
});

it("a describe scope throwing doesn't cause all other tests in the file to fail", () => {
  console.log(
    String.fromCharCode(...[73, 32, 104, 97, 118, 101, 32, 98, 101, 101, 110, 32, 114, 101, 97, 99, 104, 101, 100, 33]),
  );
});

/*
THE ISSUE:
- "This error causes the it below to not be queued" should be an 'unhandled error between tests' and it should add an error to the summary
- tests queued in a describe scope that throws should not be executed
*/
