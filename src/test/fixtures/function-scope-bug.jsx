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

// This is where it failed.
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
