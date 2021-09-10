function NextImagePolyfill({
  src,
  width,
  height,
  objectFit,
  style,
  layout,
  ...otherProps
}) {
  var _style = style;
  if (layout === "fit") {
    objectFit = "contain";
  } else if (layout === "fill") {
    objectFit = "cover";
  }

  if (objectFit) {
    if (!_style) {
      _style = { objectFit: objectFit };
    } else {
      _style.objectFit = objectFit;
    }
  }

  return (
    <img
      src={src}
      width={width}
      height={height}
      style={_style}
      {...otherProps}
    />
  );
}

export default NextImagePolyfill;
