%%raw(`import "./App.css"`)

@module("./logo.svg")
external logo: string = "default"

@react.component
let make = () =>
  <div className="App">
    <header className="App-header">
      <img src={logo} className="App-logo" alt="logo" />
      <h3> {"Welcome to React!"->React.string} </h3>
      <a className="App-link" href="https://reactjs.org" target="_blank" rel="noopener noreferrer">
        {"Learn React"->React.string}
      </a>
    </header>
  </div>
