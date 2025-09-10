import jwt from "jsonwebtoken";
jwt.sign(
  {
    iss: "bar",
    iat: 1757476476,
  },
  "secret",
  {
    algorithm: "HS256",
    issuer: "foo",
  },
  (err, asyncSigned) => {
    console.log(err, asyncSigned);
  },
);
