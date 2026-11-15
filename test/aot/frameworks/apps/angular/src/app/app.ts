import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({ selector: "app-root", imports: [RouterOutlet], template: `<header>the layout</header><router-outlet />` })
export class App {}
