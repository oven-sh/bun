// The same routes as ../../app/server.ts, on net/http.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
)

type message struct {
	Message string `json:"message"`
}

func plaintext(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Server", "Go")
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte("Hello, World!"))
}

func jsonMessage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Server", "Go")
	w.Header().Set("Content-Type", "application/json")
	body, _ := json.Marshal(message{Message: "Hello, World!"})
	w.Write(body)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/plaintext", plaintext)
	mux.HandleFunc("/json", jsonMessage)
	register(mux)
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("listening", listener.Addr().(*net.TCPAddr).Port)
	log.Fatal(http.Serve(listener, mux))
}
