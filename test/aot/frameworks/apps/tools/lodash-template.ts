import _ from "lodash";

try {
  const compiled = _.template(
    "hello <%= user %>! <% _.forEach(items, function (item) { %><li><%- item %></li><% }); %>",
  );
  console.log(compiled({ user: "fred", items: ["a", "<b>"] }));
} catch (error) {
  console.log("THROWS", (error as Error).name, (error as Error).message.slice(0, 120));
}
