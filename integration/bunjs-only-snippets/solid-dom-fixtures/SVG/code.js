const template = (
  <svg width="400" height="180">
    <rect
      stroke-width="2"
      x="50"
      y="20"
      rx="20"
      ry="20"
      width="150"
      height="150"
      style="fill:red;stroke:black;stroke-width:5;opacity:0.5"
    />
    <linearGradient gradientTransform="rotate(25)">
      <stop offset="0%"></stop>
    </linearGradient>
  </svg>
);

const template2 = (
  <svg width="400" height="180">
    <rect
      className={state.name}
      stroke-width={state.width}
      x={state.x}
      y={state.y}
      rx="20"
      ry="20"
      width="150"
      height="150"
      style={{
        fill: "red",
        stroke: "black",
        "stroke-width": props.stroke,
        opacity: 0.5,
      }}
    />
  </svg>
);

const template3 = (
  <svg width="400" height="180">
    <rect {...props} />
  </svg>
);

const template4 = <rect x="50" y="20" width="150" height="150" />;

const template5 = (
  <>
    <rect x="50" y="20" width="150" height="150" />
  </>
);

const template6 = (
  <Component>
    <rect x="50" y="20" width="150" height="150" />
  </Component>
);

const template7 = (
  <svg viewBox={"0 0 160 40"} xmlns="http://www.w3.org/2000/svg">
    <a xlink:href={url}>
      <text x="10" y="25">
        MDN Web Docs
      </text>
    </a>
  </svg>
);

const template8 = (
  <svg viewBox={"0 0 160 40"} xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="25" textContent={text} />
  </svg>
);
