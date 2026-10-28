import * as cheerio from "cheerio";
import ejs from "ejs";
import Handlebars from "handlebars";
import { marked } from "marked";
import Mustache from "mustache";
import pug from "pug";

const people = [{ id: 1, name: "ada" }, { id: 2, name: "grace" }];
console.log(ejs.render(`<ul><% for (const person of people) { %><li><%= person.name.toUpperCase() %></li><% } %></ul>`, { people }));
Handlebars.registerHelper("shout", (text: string) => text.toUpperCase() + "!");
console.log(Handlebars.compile(`<ul>{{#each people}}<li>{{shout name}} {{@index}}</li>{{/each}}</ul>`)({ people }));
console.log(pug.render(`ul\n  each person in people\n    li(data-id=person.id)= person.name`, { people }));
console.log(Mustache.render(`{{#people}}<b>{{name}}</b>{{/people}}{{^nobody}}none{{/nobody}}`, { people }));
console.log((await marked.parse("# a title\n\n- one\n- *two*\n\n`code`")).replace(/\n/g, ""));
const $ = cheerio.load(`<main><p class="a">one</p><p>two</p></main>`);
$("p.a").addClass("b").text("changed");
console.log($("p").map((_, element) => $(element).text()).get().join(), $("main").html());
console.log("DONE");
