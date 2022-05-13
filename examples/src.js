import { getProducts } from "macro:./getProducts.js";
import { isRoute } from "macro:./isRoute.js";

if (isRoute("/rickroll")) {
  document.body.innerHTML = `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
} else if (isRoute("/products")) {
  const products = getProducts({ ProductName: "name", Id: "id" });
  document.body.innerHTML = `<ul>${products
    .map(({ name, id }) => `<li>${name}</li>`)
    .join("")}</ul>`;
}
