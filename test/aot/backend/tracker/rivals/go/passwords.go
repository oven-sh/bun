package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

// PBKDF2-HMAC-SHA256, 100,000 rounds.
func passwordMatches(password, salt, hash string) bool {
	derived, err := pbkdf2.Key(sha256.New, password, []byte(salt), 100_000, 32)
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(hash)
	return err == nil && subtle.ConstantTimeCompare(derived, expected) == 1
}

func randomToken(bytes int) string {
	token := make([]byte, bytes)
	rand.Read(token)
	return hex.EncodeToString(token)
}
