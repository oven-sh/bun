var Button = () => {
  return <div className="button">Button!</div>;
};

var Bar = () => {
  return (
    <div prop={1}>
      Plain text
      <div>
        &larr; A child div
        <Button>Red</Button>
      </div>
    </div>
  );
};

// It failed while parsing this function.
// The bug happened due to incorrectly modifying scopes_in_order
// The fix was using tombstoning instead of deleting
// The fix also resolved some performance issues.
var Baz = () => {
  return (
    <div prop={1}>
      Plain text
      <div>
        &larr; A child div
        <Button>Red</Button>
      </div>
    </div>
  );
};
