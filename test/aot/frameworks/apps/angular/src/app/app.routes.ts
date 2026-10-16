import type { Routes } from "@angular/router";
import { Data } from "./data";
import { Home } from "./home";
import { NotFound } from "./not-found";
import { Person } from "./person";

export const routes: Routes = [
  { path: "", component: Home, title: "smoke" },
  { path: "data", component: Data, title: "data" },
  { path: "person/:id", component: Person },
  { path: "lazy", loadComponent: () => import("./lazy").then(m => m.Lazy) },
  { path: "**", component: NotFound },
];
